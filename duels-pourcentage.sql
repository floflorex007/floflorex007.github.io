-- =========================================================
-- BetLab : duels en pourcentage du solde (remplace les règles de duels.sql)
--
-- - Chacun mise un pourcentage de SON solde dans le groupe (1 à 50 %),
--   choisi par lui : celui qui défie en lançant le défi, l'autre en acceptant.
-- - Les deux peuvent prendre le même choix.
-- - Un seul a le bon choix : il récupère les 2 mises.
-- - Les deux ont le bon choix : celui qui a misé le plus gros pourcentage
--   récupère les 2 mises ; même pourcentage = chacun récupère sa mise.
-- - Aucun des deux n'a le bon choix : les 2 mises sont perdues.
-- - Refuser un défi coûte 1 % de son solde (ne pas répondre ne coûte rien).
-- - Pari annulé : tout le monde retrouve sa mise.
--
-- À lancer après duels.sql.
-- =========================================================

alter table public.duels
    add column if not exists challenger_pct integer,
    add column if not exists opponent_pct integer,
    add column if not exists opponent_amount numeric;

alter table public.duels drop constraint if exists duels_status_check;
alter table public.duels add constraint duels_status_check
    check (status in ('pending', 'active', 'won', 'draw', 'lost', 'refused', 'expired', 'cancelled'));


-- Mise d'un pourcentage du solde (arrondie à l'euro, 10 € minimum).
create or replace function public.duel_stake_of(p_balance numeric, p_pct integer)
returns numeric
language sql
immutable
as $$
    select greatest(10, floor(coalesce(p_balance, 0) * p_pct / 100.0));
$$;


drop function if exists public.duel_challenge(uuid, uuid, uuid, numeric);

create or replace function public.duel_challenge(p_group uuid, p_opponent uuid, p_choice uuid, p_pct integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_balance numeric;
    v_amount numeric;
    v_id uuid;
begin
    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_opponent = v_user then
        raise exception 'Tu ne peux pas te défier toi-même.';
    end if;

    if exists (select 1 from profiles where id in (v_user, p_opponent) and is_admin) then
        raise exception 'Les duels ne sont pas possibles avec le compte admin.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = p_opponent) then
        raise exception 'Ce joueur ne fait pas partie du groupe.';
    end if;

    if p_pct is null or p_pct < 1 or p_pct > 50 then
        raise exception 'Choisis un pourcentage de ton solde entre 1 et 50 %%.';
    end if;

    select b.* into v_bet
    from bet_choices c
    join bets b on b.id = c.bet_id
    where c.id = p_choice;

    if v_bet is null or v_bet.group_id <> p_group then
        raise exception 'Ce pari ne fait pas partie du groupe.';
    end if;

    if v_bet.status <> 'open' or (v_bet.deadline_at is not null and v_bet.deadline_at <= now()) then
        raise exception 'Ce pari n''est plus ouvert.';
    end if;

    if v_bet.author_id in (v_user, p_opponent) then
        raise exception 'Pas de duel sur un pari créé par l''un de vous deux.';
    end if;

    if v_bet.target_blocked and v_bet.target_user_id in (v_user, p_opponent) then
        raise exception 'Ce pari concerne l''un de vous deux : pas de duel dessus.';
    end if;

    if exists (
        select 1 from duels
        where bet_id = v_bet.id
          and status in ('pending', 'active')
          and ((challenger = v_user and opponent = p_opponent) or (challenger = p_opponent and opponent = v_user))
    ) then
        raise exception 'Il y a déjà un duel entre vous deux sur ce pari.';
    end if;

    select balance into v_balance
    from group_members
    where group_id = p_group and user_id = v_user
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    v_amount := duel_stake_of(v_balance, p_pct);

    if v_amount > v_balance then
        raise exception 'Solde insuffisant : il faut au moins 10 €.';
    end if;

    perform duel_pay(p_group, v_user, -v_amount);

    insert into duels (group_id, bet_id, challenger, opponent, challenger_choice, amount, challenger_pct, expires_at)
    values (p_group, v_bet.id, v_user, p_opponent, p_choice, v_amount, p_pct,
            least(now() + interval '24 hours', coalesce(v_bet.deadline_at, now() + interval '24 hours')))
    returning id into v_id;

    insert into player_notices (user_id, title, content)
    values (p_opponent, '⚔️ Tu es défié !',
            duel_name(v_user) || ' te défie sur « ' || v_bet.question || ' » en misant ' || p_pct
            || ' % de son solde. Réponds depuis la page Paris (24 h). Refuser coûte 1 % de ton solde.');

    return v_id;
end;
$$;


drop function if exists public.duel_answer(uuid, boolean, uuid);

create or replace function public.duel_answer(p_duel uuid, p_accept boolean, p_choice uuid default null, p_pct integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_duel record;
    v_balance numeric;
    v_amount numeric;
    v_penalty numeric;
begin
    select group_id into v_duel from duels where id = p_duel;

    if v_duel is null then
        raise exception 'Défi introuvable.';
    end if;

    perform duel_expire(v_duel.group_id);

    select d.*, b.question into v_duel
    from duels d
    join bets b on b.id = d.bet_id
    where d.id = p_duel
    for update of d;

    if v_duel.opponent is distinct from v_user then
        raise exception 'Ce défi ne t''est pas adressé.';
    end if;

    if v_duel.status <> 'pending' then
        raise exception 'Ce défi n''attend plus de réponse.';
    end if;

    select balance into v_balance
    from group_members
    where group_id = v_duel.group_id and user_id = v_user
    for update;

    if not p_accept then
        perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

        -- Refuser coûte 1 % de son solde.
        v_penalty := greatest(0, floor(coalesce(v_balance, 0) * 0.01));

        if v_penalty > 0 then
            perform duel_pay(v_duel.group_id, v_user, -v_penalty);
        end if;

        update duels set status = 'refused', answered_at = now(), settled_at = now() where id = p_duel;

        insert into player_notices (user_id, title, content)
        values (v_duel.challenger, '⚔️ Défi refusé',
                duel_name(v_user) || ' a refusé ton défi sur « ' || v_duel.question
                || ' » (il perd 1 % de son solde). Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').');
        return;
    end if;

    if not exists (select 1 from bet_choices where id = p_choice and bet_id = v_duel.bet_id) then
        raise exception 'Choisis un choix de ce pari.';
    end if;

    if p_pct is null or p_pct < 1 or p_pct > 50 then
        raise exception 'Choisis un pourcentage de ton solde entre 1 et 50 %%.';
    end if;

    v_amount := duel_stake_of(v_balance, p_pct);

    if v_balance is null or v_amount > v_balance then
        raise exception 'Solde insuffisant : il faut au moins 10 €.';
    end if;

    perform duel_pay(v_duel.group_id, v_user, -v_amount);

    update duels
    set status = 'active',
        opponent_choice = p_choice,
        opponent_pct = p_pct,
        opponent_amount = v_amount,
        answered_at = now()
    where id = p_duel;

    insert into player_notices (user_id, title, content)
    values (v_duel.challenger, '⚔️ Duel accepté !',
            duel_name(v_user) || ' a accepté ton duel sur « ' || v_duel.question
            || ' » en misant ' || p_pct || ' % de son solde. Le gagnant récupère '
            || format_euros(v_duel.amount + v_amount) || '.');
end;
$$;


-- Mes duels en cours, avec les pourcentages.
create or replace function public.my_duels(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform duel_expire(p_group);

    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', d.id,
            'status', d.status,
            'amount', d.amount,
            'challenger_pct', d.challenger_pct,
            'opponent_pct', d.opponent_pct,
            'opponent_amount', d.opponent_amount,
            'expires_at', d.expires_at,
            'bet_id', d.bet_id,
            'question', b.question,
            'challenger', duel_name(d.challenger),
            'challenger_id', d.challenger,
            'opponent', duel_name(d.opponent),
            'incoming', d.opponent = auth.uid(),
            'challenger_choice', d.challenger_choice,
            'challenger_label', (select label from bet_choices where id = d.challenger_choice),
            'opponent_label', (select label from bet_choices where id = d.opponent_choice),
            'choices', (select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'odds', c.odds) order by c.created_at)
                        from bet_choices c where c.bet_id = d.bet_id)
        ) order by d.created_at)
        from duels d
        join bets b on b.id = d.bet_id
        where d.group_id = p_group
          and d.status in ('pending', 'active')
          and auth.uid() in (d.challenger, d.opponent)
    ), '[]'::jsonb);
end;
$$;


-- Pari validé ou annulé : les duels se règlent tout seuls.
create or replace function public.duels_on_bet_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
    v_ok_c boolean;
    v_ok_o boolean;
    v_winner uuid;
    v_total numeric;
begin
    if new.status is not distinct from old.status then
        return new;
    end if;

    -- Défis sans réponse : la mise est rendue.
    if new.status in ('resolved', 'cancelled', 'closed') then
        for v_duel in select * from duels where bet_id = new.id and status = 'pending' for update loop
            perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
            update duels set status = 'expired', settled_at = now() where id = v_duel.id;
        end loop;
    end if;

    if new.status = 'resolved' then
        for v_duel in select * from duels where bet_id = new.id and status = 'active' for update loop

            v_ok_c := new.winner_choice_id = v_duel.challenger_choice;
            v_ok_o := new.winner_choice_id = v_duel.opponent_choice;
            v_total := v_duel.amount + coalesce(v_duel.opponent_amount, v_duel.amount);

            v_winner := case
                when v_ok_c and not v_ok_o then v_duel.challenger
                when v_ok_o and not v_ok_c then v_duel.opponent
                when v_ok_c and v_ok_o and v_duel.challenger_pct > v_duel.opponent_pct then v_duel.challenger
                when v_ok_c and v_ok_o and v_duel.opponent_pct > v_duel.challenger_pct then v_duel.opponent
            end;

            if v_winner is not null then

                perform duel_pay(v_duel.group_id, v_winner, v_total);

                update duels set status = 'won', winner = v_winner, settled_at = now() where id = v_duel.id;

                insert into player_notices (user_id, title, content)
                values
                    (v_winner, '⚔️ Duel gagné !',
                     'Tu as battu ' || duel_name(case when v_winner = v_duel.challenger then v_duel.opponent else v_duel.challenger end)
                     || ' sur « ' || new.question || ' » : +' || format_euros(v_total) || '.'),
                    (case when v_winner = v_duel.challenger then v_duel.opponent else v_duel.challenger end,
                     '⚔️ Duel perdu',
                     duel_name(v_winner) || ' a gagné votre duel sur « ' || new.question || ' »'
                     || case when v_ok_c and v_ok_o then ' : vous aviez tous les deux raison, mais il avait misé un plus gros pourcentage.' else '.' end);

            elsif v_ok_c and v_ok_o then

                -- Bon choix tous les deux, même pourcentage : chacun récupère sa mise.
                perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
                perform duel_pay(v_duel.group_id, v_duel.opponent, coalesce(v_duel.opponent_amount, v_duel.amount));

                update duels set status = 'draw', settled_at = now() where id = v_duel.id;

                insert into player_notices (user_id, title, content)
                select u, '⚔️ Duel nul',
                       'Vous aviez tous les deux raison sur « ' || new.question || ' », avec le même pourcentage : ta mise t''a été rendue.'
                from unnest(array[v_duel.challenger, v_duel.opponent]) u;

            else

                -- Aucun des deux : les 2 mises sont perdues.
                update duels set status = 'lost', settled_at = now() where id = v_duel.id;

                insert into player_notices (user_id, title, content)
                select u, '⚔️ Duel perdu pour tous les deux',
                       'Aucun de vous deux n''avait le bon choix sur « ' || new.question || ' » : les 2 mises sont perdues.'
                from unnest(array[v_duel.challenger, v_duel.opponent]) u;

            end if;
        end loop;
    end if;

    if new.status = 'cancelled' then
        for v_duel in select * from duels where bet_id = new.id and status in ('active', 'won', 'draw', 'lost') for update loop
            v_total := v_duel.amount + coalesce(v_duel.opponent_amount, v_duel.amount);

            -- Gagnant : il rend ce qu'il avait reçu ; nul : déjà rendu.
            if v_duel.status = 'won' then
                perform duel_pay(v_duel.group_id, v_duel.winner, -v_total);
            end if;

            if v_duel.status in ('active', 'won', 'lost') then
                perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
                perform duel_pay(v_duel.group_id, v_duel.opponent, coalesce(v_duel.opponent_amount, v_duel.amount));
            end if;

            update duels set status = 'cancelled', settled_at = now() where id = v_duel.id;
        end loop;
    end if;

    return new;
end;
$$;


-- Pari supprimé : les mises des duels en cours sont rendues.
create or replace function public.duels_on_bet_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
begin
    for v_duel in select * from duels where bet_id = old.id and status in ('pending', 'active') loop
        perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

        if v_duel.status = 'active' then
            perform duel_pay(v_duel.group_id, v_duel.opponent, coalesce(v_duel.opponent_amount, v_duel.amount));
        end if;
    end loop;

    return old;
end;
$$;


grant execute on function public.duel_challenge(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.duel_answer(uuid, boolean, uuid, integer) to authenticated;
