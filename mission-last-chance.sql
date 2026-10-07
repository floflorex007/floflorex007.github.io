-- =========================================================
-- BetLab : mission hebdomadaire « Last Chance »
-- (miser pendant que la carte est rouge, et gagner le pari)
--
-- À lancer après groupes-progression.sql.
-- =========================================================

create or replace function public.mission_points(p_mission text)
returns integer
language sql
immutable
as $$
    select case p_mission
        when 'connexion'    then 5
        when 'touche'       then 5
        when 'premier'      then 5
        when 'gros'         then 20
        when 'createur'     then 25
        when 'last_chance'  then 27
        when 'premier_gain' then 10
        when 'outsider'     then 20
        when 'contre'       then 30
    end;
$$;


create or replace function public.mission_eval(p_user uuid, p_group uuid, p_mission text, out progress numeric, out target numeric, out keys text[])
returns record
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_week date := date_trunc('week', v_today)::date;
    v_day_start timestamptz := v_today::timestamp at time zone 'Europe/Paris';
    v_week_start timestamptz := v_week::timestamp at time zone 'Europe/Paris';
    v_day_key text := 'J' || v_today::text;
    v_week_key text := 'S' || v_week::text;
    v_reset timestamptz := coalesce(
        (select value from app_settings where key = 'missions_reset_at'),
        '-infinity'::timestamptz
    );
begin

    -- Rien avant la dernière réinitialisation ne compte.
    v_day_start := greatest(v_day_start, v_reset);
    v_week_start := greatest(v_week_start, v_reset);

    keys := '{}';

    if p_mission = 'connexion' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'touche' then

        target := 3;

        select count(distinct s.bet_id) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'premier' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start
          and not exists (
              select 1 from stakes o
              where o.bet_id = s.bet_id
                and o.created_at < s.created_at
          );

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'gros' then

        target := 700;

        select coalesce(sum(s.stake), 0) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_week_start;

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'createur' then

        target := 5;

        -- Les mises du créateur sur son propre pari comptent aussi.
        select coalesce(max(n), 0) into progress
        from (
            select count(distinct s.user_id) as n
            from bets b
            join stakes s on s.bet_id = b.id
            where b.author_id = p_user
              and b.group_id = p_group
              and b.created_at >= v_week_start
            group by b.id
        ) t;

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'last_chance' then

        target := 1;

        -- Une mise placée pendant que la carte est rouge (entre 2 h et 1 h
        -- avant l'échéance), sur un pari gagné.
        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and b.status = 'resolved'
          and s.created_at >= v_week_start
          and b.winner_choice_id = s.choice_id
          and b.deadline_at is not null
          and s.created_at >= b.deadline_at - interval '2 hours'
          and s.created_at < b.deadline_at - interval '1 hour';

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'premier_gain' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and b.status = 'resolved'
          and s.created_at >= v_reset
          and b.winner_choice_id = s.choice_id;

        if progress >= target then keys := array['unique']; end if;

    elsif p_mission = 'outsider' then

        target := 1;

        keys := array(
            select distinct s.bet_id::text
            from stakes s
            join bets b on b.id = s.bet_id
            join bet_choices c on c.id = s.choice_id
            where s.user_id = p_user
              and b.group_id = p_group
              and b.status = 'resolved'
              and s.created_at >= v_reset
              and b.winner_choice_id = s.choice_id
              and c.odds > 3
        );

        progress := cardinality(keys);

    elsif p_mission = 'contre' then

        target := 1;

        -- Le choix gagnant doit avoir strictement moins de mises
        -- que chacun des autres choix du pari.
        keys := array(
            select distinct s.bet_id::text
            from stakes s
            join bets b on b.id = s.bet_id
            where s.user_id = p_user
              and b.group_id = p_group
              and b.status = 'resolved'
              and s.created_at >= v_reset
              and b.winner_choice_id = s.choice_id
              and exists (
                  select 1 from bet_choices c2
                  where c2.bet_id = s.bet_id and c2.id <> s.choice_id
              )
              and (select count(*) from stakes x where x.choice_id = s.choice_id)
                  < all (
                      select count(x2.id)
                      from bet_choices c2
                      left join stakes x2 on x2.choice_id = c2.id
                      where c2.bet_id = s.bet_id
                        and c2.id <> s.choice_id
                      group by c2.id
                  )
        );

        progress := cardinality(keys);

    else

        raise exception 'Mission inconnue : %', p_mission;

    end if;

    progress := least(progress, target);

end;
$$;


create or replace function public.mission_progress(p_group uuid)
returns table(mission text, progress numeric, target numeric, claimable integer, claimed integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_mission text;
    v_eval record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    foreach v_mission in array array[
        'connexion', 'touche', 'premier', 'gros',
        'createur', 'last_chance', 'premier_gain', 'outsider', 'contre'
    ]
    loop

        select * into v_eval from mission_eval(v_user, p_group, v_mission);

        mission := v_mission;
        progress := v_eval.progress;
        target := v_eval.target;

        select count(*) into claimable
        from unnest(v_eval.keys) k
        where not exists (
            select 1 from mission_claims mc
            where mc.user_id = v_user
              and mc.group_id = p_group
              and mc.mission = v_mission
              and mc.period_key = k
        );

        select count(*) into claimed
        from unnest(v_eval.keys) k
        join mission_claims mc
          on mc.user_id = v_user
         and mc.group_id = p_group
         and mc.mission = v_mission
         and mc.period_key = k;

        return next;

    end loop;

end;
$$;
