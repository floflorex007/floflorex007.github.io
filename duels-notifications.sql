-- =========================================================
-- BetLab : notifications des duels en face à face
-- (maquette demo-notifs-duels.html, style B)
--
-- Chaque message de duel (player_notices) garde aussi ses informations
-- dans la colonne data, pour que l'app dessine la fenêtre « face à face » :
--   { kind, other, question, mine, theirs, amount }
-- kind : duel_received, duel_accepted, duel_coin_win, duel_coin_lose,
--        duel_refused, duel_expired, duel_cancelled, duel_won, duel_won_coin,
--        duel_lost, duel_lost_coin, duel_lost_both.
-- amount : la mise d'un joueur (les 2 mises = 2 × amount).
--
-- Nouveau : un message « Duel annulé » quand le pari est annulé ou supprimé,
-- et « Défi expiré » quand le pari se ferme avant la réponse.
--
-- À lancer après duels-meme-mise.sql.
-- =========================================================

alter table public.player_notices
    add column if not exists data jsonb;


create or replace function public.duel_label(p_choice uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select label from bet_choices where id = p_choice;
$$;


-- Message de duel : texte (pour l'ancien affichage) + données du face à face.
create or replace function public.duel_notify(
    p_user uuid, p_title text, p_content text,
    p_kind text, p_other uuid, p_question text, p_mine uuid, p_theirs uuid, p_amount numeric
)
returns void
language sql
security definer
set search_path = public
as $$
    insert into player_notices (user_id, title, content, data)
    values (p_user, p_title, p_content, jsonb_build_object(
        'kind', p_kind,
        'other', duel_name(p_other),
        'question', p_question,
        'mine', duel_label(p_mine),
        'theirs', duel_label(p_theirs),
        'amount', p_amount
    ));
$$;


-- Défis sans réponse à temps : la mise est rendue.
create or replace function public.duel_expire(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
begin
    for v_duel in
        select d.*, b.question
        from duels d
        join bets b on b.id = d.bet_id
        where d.group_id = p_group
          and d.status = 'pending'
          and (d.expires_at <= now()
               or b.status <> 'open'
               or (b.deadline_at is not null and b.deadline_at <= now()))
        for update of d
    loop
        perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

        update duels set status = 'expired', settled_at = now() where id = v_duel.id;

        perform duel_notify(v_duel.challenger, '⚔️ Défi expiré',
            duel_name(v_duel.opponent) || ' n''a pas répondu à ton défi sur « ' || v_duel.question
            || ' ». Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').',
            'duel_expired', v_duel.opponent, v_duel.question, v_duel.challenger_choice, null, v_duel.amount);
    end loop;
end;
$$;


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

    perform duel_notify(p_opponent, '⚔️ Tu es défié !',
        duel_name(v_user) || ' te défie sur « ' || v_bet.question || ' » en misant ' || format_euros(v_amount)
        || ' (tu mises la même somme). Réponds depuis la page Paris ou « ⚔️ Mes défis » (24 h). Refuser coûte 1 % de ton solde.',
        'duel_received', v_user, v_bet.question, null, p_choice, v_amount);

    return v_id;
end;
$$;


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

        perform duel_notify(v_duel.challenger, '⚔️ Défi refusé',
            duel_name(v_user) || ' a refusé ton défi sur « ' || v_duel.question
            || ' » (il perd 1 % de son solde). Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').',
            'duel_refused', v_user, v_duel.question, v_duel.challenger_choice, null, v_duel.amount);

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

    perform duel_notify(v_duel.challenger, '⚔️ Duel accepté !',
        duel_name(v_user) || ' a accepté ton duel sur « ' || v_duel.question || ' ». '
        || case
            when v_coin is null then 'Le gagnant récupère ' || format_euros(2 * v_duel.amount) || '.'
            when v_coin = v_duel.challenger then 'Vous avez pris le même choix : tu as gagné le pile ou face, tu récupères '
                || format_euros(2 * v_duel.amount) || ' si « ' || v_label || ' » gagne.'
            else 'Vous avez pris le même choix : il a gagné le pile ou face, il récupère '
                || format_euros(2 * v_duel.amount) || ' si « ' || v_label || ' » gagne.'
           end,
        case
            when v_coin is null then 'duel_accepted'
            when v_coin = v_duel.challenger then 'duel_coin_win'
            else 'duel_coin_lose'
        end,
        v_user, v_duel.question, v_duel.challenger_choice, p_choice, v_duel.amount);

    return jsonb_build_object(
        'accepted', true,
        'same_choice', v_coin is not null,
        'coin_me', v_coin = v_user,
        'label', v_label,
        'total', 2 * v_duel.amount
    );
end;
$$;


-- Pari validé, fermé ou annulé : les duels se règlent tout seuls.
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
    v_coin boolean;
begin
    if new.status is not distinct from old.status then
        return new;
    end if;

    -- Défis sans réponse : la mise est rendue.
    if new.status in ('resolved', 'cancelled', 'closed') then
        for v_duel in select * from duels where bet_id = new.id and status = 'pending' for update loop
            perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
            update duels set status = 'expired', settled_at = now() where id = v_duel.id;

            if new.status = 'cancelled' then
                perform duel_notify(v_duel.challenger, '⚔️ Duel annulé',
                    'Le pari « ' || new.question || ' » a été annulé : ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').',
                    'duel_cancelled', v_duel.opponent, new.question, v_duel.challenger_choice, null, v_duel.amount);
            else
                perform duel_notify(v_duel.challenger, '⚔️ Défi expiré',
                    duel_name(v_duel.opponent) || ' n''a pas répondu à temps à ton défi sur « ' || new.question
                    || ' ». Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').',
                    'duel_expired', v_duel.opponent, new.question, v_duel.challenger_choice, null, v_duel.amount);
            end if;
        end loop;
    end if;

    if new.status = 'resolved' then
        for v_duel in select * from duels where bet_id = new.id and status = 'active' for update loop

            v_ok_c := new.winner_choice_id = v_duel.challenger_choice;
            v_ok_o := new.winner_choice_id = v_duel.opponent_choice;
            v_total := v_duel.amount + coalesce(v_duel.opponent_amount, v_duel.amount);
            v_coin := v_ok_c and v_ok_o and v_duel.coin_winner is not null;

            v_winner := case
                when v_ok_c and not v_ok_o then v_duel.challenger
                when v_ok_o and not v_ok_c then v_duel.opponent
                -- Même choix, et il gagne : le gagnant du pile ou face.
                when v_coin then v_duel.coin_winner
                -- Anciens duels en pourcentage : le plus gros pourcentage.
                when v_ok_c and v_ok_o and v_duel.challenger_pct > v_duel.opponent_pct then v_duel.challenger
                when v_ok_c and v_ok_o and v_duel.opponent_pct > v_duel.challenger_pct then v_duel.opponent
            end;

            if v_winner is not null then

                v_loser := case when v_winner = v_duel.challenger then v_duel.opponent else v_duel.challenger end;

                perform duel_pay(v_duel.group_id, v_winner, v_total);

                update duels set status = 'won', winner = v_winner, settled_at = now() where id = v_duel.id;

                perform duel_notify(v_winner, '⚔️ Duel gagné !',
                    'Tu as battu ' || duel_name(v_loser) || ' sur « ' || new.question || ' »'
                    || case when v_coin then ' grâce au pile ou face' else '' end
                    || ' : +' || format_euros(v_total) || '.',
                    case when v_coin then 'duel_won_coin' else 'duel_won' end,
                    v_loser, new.question,
                    case when v_winner = v_duel.challenger then v_duel.challenger_choice else v_duel.opponent_choice end,
                    case when v_winner = v_duel.challenger then v_duel.opponent_choice else v_duel.challenger_choice end,
                    v_duel.amount);

                perform duel_notify(v_loser, '⚔️ Duel perdu',
                    duel_name(v_winner) || ' a gagné votre duel sur « ' || new.question || ' »'
                    || case
                        when v_coin then ' : vous aviez tous les deux raison, mais il avait gagné le pile ou face.'
                        when v_ok_c and v_ok_o then ' : vous aviez tous les deux raison, mais il avait misé un plus gros pourcentage.'
                        else '.'
                       end,
                    case when v_coin then 'duel_lost_coin' else 'duel_lost' end,
                    v_winner, new.question,
                    case when v_loser = v_duel.challenger then v_duel.challenger_choice else v_duel.opponent_choice end,
                    case when v_loser = v_duel.challenger then v_duel.opponent_choice else v_duel.challenger_choice end,
                    v_duel.amount);

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

                perform duel_notify(v_duel.challenger, '⚔️ Duel perdu pour tous les deux',
                    'Aucun de vous deux n''avait le bon choix sur « ' || new.question || ' » : les 2 mises sont perdues.',
                    'duel_lost_both', v_duel.opponent, new.question, v_duel.challenger_choice, v_duel.opponent_choice, v_duel.amount);

                perform duel_notify(v_duel.opponent, '⚔️ Duel perdu pour tous les deux',
                    'Aucun de vous deux n''avait le bon choix sur « ' || new.question || ' » : les 2 mises sont perdues.',
                    'duel_lost_both', v_duel.challenger, new.question, v_duel.opponent_choice, v_duel.challenger_choice,
                    coalesce(v_duel.opponent_amount, v_duel.amount));

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

            perform duel_notify(v_duel.challenger, '⚔️ Duel annulé',
                'Le pari « ' || new.question || ' » a été annulé : chacun récupère sa mise.',
                'duel_cancelled', v_duel.opponent, new.question, v_duel.challenger_choice, v_duel.opponent_choice, v_duel.amount);

            perform duel_notify(v_duel.opponent, '⚔️ Duel annulé',
                'Le pari « ' || new.question || ' » a été annulé : chacun récupère sa mise.',
                'duel_cancelled', v_duel.challenger, new.question, v_duel.opponent_choice, v_duel.challenger_choice,
                coalesce(v_duel.opponent_amount, v_duel.amount));
        end loop;
    end if;

    return new;
end;
$$;


-- Pari supprimé : les mises des duels en cours sont rendues, et on prévient.
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

        insert into player_notices (user_id, title, content, data)
        values (v_duel.challenger, '⚔️ Duel annulé',
                'Le pari « ' || old.question || ' » a été supprimé : ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').',
                jsonb_build_object('kind', 'duel_cancelled', 'other', duel_name(v_duel.opponent), 'question', old.question,
                                   'mine', null, 'theirs', null, 'amount', v_duel.amount));

        if v_duel.status = 'active' then
            perform duel_pay(v_duel.group_id, v_duel.opponent, coalesce(v_duel.opponent_amount, v_duel.amount));

            insert into player_notices (user_id, title, content, data)
            values (v_duel.opponent, '⚔️ Duel annulé',
                    'Le pari « ' || old.question || ' » a été supprimé : ta mise t''a été rendue (+'
                    || format_euros(coalesce(v_duel.opponent_amount, v_duel.amount)) || ').',
                    jsonb_build_object('kind', 'duel_cancelled', 'other', duel_name(v_duel.challenger), 'question', old.question,
                                       'mine', null, 'theirs', null, 'amount', coalesce(v_duel.opponent_amount, v_duel.amount)));
        end if;
    end loop;

    return old;
end;
$$;


-- Seule la base dépose des messages : pas d'appel direct depuis l'app.
revoke execute on function public.duel_notify(uuid, text, text, text, uuid, text, uuid, uuid, numeric) from public, anon, authenticated;

grant execute on function public.duel_challenge(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.duel_answer(uuid, boolean, uuid) to authenticated;
