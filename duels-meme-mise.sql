-- =========================================================
-- BetLab : duels à mise égale (remplace les règles en pourcentage
-- de duels-pourcentage.sql)
--
-- - Celui qui défie choisit la mise, en euros : 10 € minimum et au plus
--   30 % du solde du plus pauvre des deux (solde dans le groupe).
-- - Celui qui accepte mise exactement la même somme.
-- - Choix différents : celui qui a le bon choix récupère les 2 mises
--   (aucun des deux : les 2 mises sont perdues).
-- - Même choix : pile ou face au moment où le défi est accepté ; si ce
--   choix gagne, le gagnant du pile ou face récupère les 2 mises
--   (s'il perd, les 2 mises sont perdues).
-- - Refuser coûte toujours 1 % de son solde (ne pas répondre : rien).
--
-- Les anciens duels en pourcentage gardent leur règle au moment du résultat.
-- À lancer après duels-historique.sql et duels-un-a-la-fois.sql.
-- =========================================================

alter table public.duels
    add column if not exists coin_winner uuid references auth.users (id);


-- Mise maximale d'un duel : 30 % du solde du plus pauvre des deux.
create or replace function public.duel_max_stake(p_group uuid, p_a uuid, p_b uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select floor(0.30 * coalesce(min(balance), 0))
    from group_members
    where group_id = p_group and user_id in (p_a, p_b);
$$;


drop function if exists public.duel_challenge(uuid, uuid, uuid, integer);

create or replace function public.duel_challenge(p_group uuid, p_opponent uuid, p_choice uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_balance numeric;
    v_max numeric;
    v_amount numeric := floor(coalesce(p_amount, 0));
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

    -- Un seul défi à la fois entre deux joueurs (duels-un-a-la-fois.sql).
    if exists (
        select 1 from duels
        where status in ('pending', 'active')
          and ((challenger = v_user and opponent = p_opponent) or (challenger = p_opponent and opponent = v_user))
    ) then
        raise exception 'Vous avez déjà un défi en cours tous les deux : attends qu''il soit terminé.';
    end if;

    select balance into v_balance
    from group_members
    where group_id = p_group and user_id = v_user
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    v_max := duel_max_stake(p_group, v_user, p_opponent);

    if v_max < 10 then
        raise exception 'Pas de duel possible : l''un de vous deux a moins de 34 € (mise max = 30 %% du solde du plus pauvre).';
    end if;

    if v_amount < 10 or v_amount > v_max then
        raise exception 'Choisis une mise entre 10 € et % (30 %% du solde du plus pauvre de vous deux).', format_euros(v_max);
    end if;

    perform duel_pay(p_group, v_user, -v_amount);

    insert into duels (group_id, bet_id, challenger, opponent, challenger_choice, amount, expires_at)
    values (p_group, v_bet.id, v_user, p_opponent, p_choice, v_amount,
            least(now() + interval '24 hours', coalesce(v_bet.deadline_at, now() + interval '24 hours')))
    returning id into v_id;

    insert into player_notices (user_id, title, content)
    values (p_opponent, '⚔️ Tu es défié !',
            duel_name(v_user) || ' te défie sur « ' || v_bet.question || ' » en misant ' || format_euros(v_amount)
            || ' (tu mises la même somme). Réponds depuis la page Paris ou « ⚔️ Mes défis » (24 h). Refuser coûte 1 % de ton solde.');

    return v_id;
end;
$$;


drop function if exists public.duel_answer(uuid, boolean, uuid, integer);

-- Renvoie, quand le défi est accepté sur le même choix, le résultat du pile ou face.
create or replace function public.duel_answer(p_duel uuid, p_accept boolean, p_choice uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_duel record;
    v_balance numeric;
    v_penalty numeric;
    v_coin uuid;
    v_label text;
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

        update duels
        set status = 'refused', answered_at = now(), settled_at = now(), refusal_penalty = v_penalty
        where id = p_duel;

        insert into player_notices (user_id, title, content)
        values (v_duel.challenger, '⚔️ Défi refusé',
                duel_name(v_user) || ' a refusé ton défi sur « ' || v_duel.question
                || ' » (il perd 1 % de son solde). Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').');

        return jsonb_build_object('accepted', false);
    end if;

    select label into v_label from bet_choices where id = p_choice and bet_id = v_duel.bet_id;

    if v_label is null then
        raise exception 'Choisis un choix de ce pari.';
    end if;

    -- Même mise que celui qui défie.
    if v_balance is null or v_balance < v_duel.amount then
        raise exception 'Solde insuffisant : il te faut % pour accepter.', format_euros(v_duel.amount);
    end if;

    perform duel_pay(v_duel.group_id, v_user, -v_duel.amount);

    -- Même choix : pile ou face tout de suite pour savoir qui prendra les 2 mises.
    if p_choice = v_duel.challenger_choice then
        v_coin := case when random() < 0.5 then v_duel.challenger else v_user end;
    end if;

    update duels
    set status = 'active',
        opponent_choice = p_choice,
        opponent_amount = v_duel.amount,
        coin_winner = v_coin,
        answered_at = now()
    where id = p_duel;

    insert into player_notices (user_id, title, content)
    values (v_duel.challenger, '⚔️ Duel accepté !',
            duel_name(v_user) || ' a accepté ton duel sur « ' || v_duel.question || ' ». '
            || case
                when v_coin is null then 'Le gagnant récupère ' || format_euros(2 * v_duel.amount) || '.'
                when v_coin = v_duel.challenger then 'Vous avez pris le même choix : tu as gagné le pile ou face, tu récupères '
                    || format_euros(2 * v_duel.amount) || ' si « ' || v_label || ' » gagne.'
                else 'Vous avez pris le même choix : il a gagné le pile ou face, il récupère '
                    || format_euros(2 * v_duel.amount) || ' si « ' || v_label || ' » gagne.'
               end);

    return jsonb_build_object(
        'accepted', true,
        'same_choice', v_coin is not null,
        'coin_me', v_coin = v_user,
        'label', v_label,
        'total', 2 * v_duel.amount
    );
end;
$$;


-- Mes duels en cours, avec la mise max pour un défi reçu et le pile ou face.
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
            'coin_winner', duel_name(d.coin_winner),
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
    v_loser uuid;
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
                -- Même choix, et il gagne : le gagnant du pile ou face.
                when v_ok_c and v_ok_o and v_duel.coin_winner is not null then v_duel.coin_winner
                -- Anciens duels en pourcentage : le plus gros pourcentage.
                when v_ok_c and v_ok_o and v_duel.challenger_pct > v_duel.opponent_pct then v_duel.challenger
                when v_ok_c and v_ok_o and v_duel.opponent_pct > v_duel.challenger_pct then v_duel.opponent
            end;

            if v_winner is not null then

                v_loser := case when v_winner = v_duel.challenger then v_duel.opponent else v_duel.challenger end;

                perform duel_pay(v_duel.group_id, v_winner, v_total);

                update duels set status = 'won', winner = v_winner, settled_at = now() where id = v_duel.id;

                insert into player_notices (user_id, title, content)
                values
                    (v_winner, '⚔️ Duel gagné !',
                     'Tu as battu ' || duel_name(v_loser) || ' sur « ' || new.question || ' »'
                     || case when v_ok_c and v_ok_o and v_duel.coin_winner is not null then ' grâce au pile ou face' else '' end
                     || ' : +' || format_euros(v_total) || '.'),
                    (v_loser, '⚔️ Duel perdu',
                     duel_name(v_winner) || ' a gagné votre duel sur « ' || new.question || ' »'
                     || case
                         when v_ok_c and v_ok_o and v_duel.coin_winner is not null then ' : vous aviez tous les deux raison, mais il avait gagné le pile ou face.'
                         when v_ok_c and v_ok_o then ' : vous aviez tous les deux raison, mais il avait misé un plus gros pourcentage.'
                         else '.'
                        end);

            elsif v_ok_c and v_ok_o then

                -- Ancien duel en pourcentage, même pourcentage : chacun récupère sa mise.
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


-- Historique : même chose que duels-historique.sql, avec la mise et le pile ou face.
create or replace function public.duel_history(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform duel_expire(p_group);

    return coalesce((
        select jsonb_agg(row_to_json(h)::jsonb order by h.created_at desc)
        from (
            select
                d.id,
                d.status,
                d.created_at,
                d.expires_at,
                b.question,
                d.challenger = auth.uid() as sent,
                duel_name(case when d.challenger = auth.uid() then d.opponent else d.challenger end) as other,
                case when d.challenger = auth.uid() then d.challenger_pct else d.opponent_pct end as my_pct,
                case when d.challenger = auth.uid() then d.amount else coalesce(d.opponent_amount, d.amount) end as my_amount,
                d.winner = auth.uid() as i_won,
                d.coin_winner is not null as coin,
                d.coin_winner = auth.uid() as coin_me,
                -- Ce que le duel m'a rapporté (+) ou coûté (−).
                case
                    when d.status = 'won' and d.winner = auth.uid()
                        then case when d.challenger = auth.uid() then coalesce(d.opponent_amount, d.amount) else d.amount end
                    when d.status = 'won'
                        then -(case when d.challenger = auth.uid() then d.amount else coalesce(d.opponent_amount, d.amount) end)
                    when d.status = 'lost'
                        then -(case when d.challenger = auth.uid() then d.amount else coalesce(d.opponent_amount, d.amount) end)
                    when d.status = 'refused' and d.opponent = auth.uid()
                        then -d.refusal_penalty
                    else 0
                end as delta
            from duels d
            join bets b on b.id = d.bet_id
            where d.group_id = p_group
              and auth.uid() in (d.challenger, d.opponent)
        ) h
    ), '[]'::jsonb);
end;
$$;


grant execute on function public.duel_max_stake(uuid, uuid, uuid) to authenticated;
grant execute on function public.duel_challenge(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.duel_answer(uuid, boolean, uuid) to authenticated;
grant execute on function public.duel_history(uuid) to authenticated;
