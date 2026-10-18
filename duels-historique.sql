-- =========================================================
-- BetLab : historique de mes défis (maquette demo-historique-defis.html)
--
-- duel_history : tous mes duels du groupe, envoyés et reçus, avec
-- le résultat et ce que j'ai gagné ou perdu. La pénalité de refus
-- (1 % du solde) est maintenant retenue dans le duel.
--
-- À lancer après duels-pourcentage.sql.
-- =========================================================

alter table public.duels
    add column if not exists refusal_penalty numeric not null default 0;


-- Même fonction que dans duels-pourcentage.sql, la pénalité de refus en plus.
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

        update duels
        set status = 'refused', answered_at = now(), settled_at = now(), refusal_penalty = v_penalty
        where id = p_duel;

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


-- Tous mes duels du groupe (envoyés et reçus), du plus récent au plus ancien.
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
                b.question,
                d.challenger = auth.uid() as sent,
                duel_name(case when d.challenger = auth.uid() then d.opponent else d.challenger end) as other,
                case when d.challenger = auth.uid() then d.challenger_pct else d.opponent_pct end as my_pct,
                case when d.challenger = auth.uid() then d.amount else d.opponent_amount end as my_amount,
                d.winner = auth.uid() as i_won,
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

grant execute on function public.duel_history(uuid) to authenticated;
