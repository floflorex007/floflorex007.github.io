-- =========================================================
-- BetLab : fermeture des mises selon la durée du pari
--
-- À lancer après cloture-mises.sql et mission-last-chance.sql.
-- Durée du pari = échéance - création :
--   - plus de 1 h 30 : les mises ferment 1 h avant l'échéance ;
--   - de 30 min à 1 h 30 : 15 min avant (publié à 8 h pour 9 h → fermé à 8 h 45) ;
--   - 30 min ou moins (pari express) : 5 min avant.
-- La mission « Last Chance » suit la même règle : miser pendant que la carte est rouge
-- (2 h avant pour un pari classique, dès la publication pour un pari court).
-- Même règle côté navigateur : betCloseMs() dans app.js.
-- =========================================================

create or replace function public.bet_close_interval(p_created_at timestamptz, p_deadline_at timestamptz)
returns interval
language sql
immutable
as $$
    select case
        when p_created_at is null or p_deadline_at - p_created_at > interval '90 minutes' then interval '1 hour'
        when p_deadline_at - p_created_at > interval '30 minutes' then interval '15 minutes'
        else interval '5 minutes'
    end;
$$;


CREATE OR REPLACE FUNCTION public.place_bet(p_choice_id uuid, p_stake numeric)
 RETURNS stakes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_balance numeric;
    v_bet_id uuid;
    v_group_id uuid;
    v_odds numeric;
    v_potential_win numeric;
    v_stake public.stakes;
begin

    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Utilisateur non connecté';
    end if;


    if p_stake is null or p_stake <= 0 then
        raise exception 'La mise doit être supérieure à 0';
    end if;

    if p_stake <> trunc(p_stake) then
        raise exception 'La mise doit être un montant rond (sans centimes)';
    end if;

    if p_stake < 10 or p_stake > 5000 then
        raise exception 'La mise doit être comprise entre 10 € et 5 000 €';
    end if;


    select bc.bet_id, bc.odds, b.group_id
    into v_bet_id, v_odds, v_group_id
    from public.bet_choices bc
    join public.bets b
        on b.id = bc.bet_id
    where bc.id = p_choice_id
      and b.status = 'open';

    if v_bet_id is null then
        raise exception 'Ce pari n''est plus disponible';
    end if;


    if exists (
        select 1 from public.bets
        where id = v_bet_id
          and deadline_at is not null
          and now() >= deadline_at - public.bet_close_interval(created_at, deadline_at)
    ) then
        raise exception 'Les mises sont closes (échéance trop proche)';
    end if;


    select balance
    into v_balance
    from public.group_members
    where group_id = v_group_id
      and user_id = v_user_id
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe';
    end if;

    -- Le solde est verrouillé : deux mises simultanées ne peuvent pas dépasser la limite.
    if (select count(*) from public.stakes
        where bet_id = v_bet_id
          and user_id = v_user_id) >= 3
    then
        raise exception 'Tu as déjà placé 3 mises sur ce pari (maximum)';
    end if;

    if v_balance < p_stake then
        raise exception 'Solde insuffisant';
    end if;


    v_potential_win := round(p_stake * v_odds, 2);


    update public.group_members
    set balance = balance - p_stake
    where group_id = v_group_id
      and user_id = v_user_id;


    insert into public.stakes (
        bet_id,
        choice_id,
        user_id,
        stake,
        potential_win
    )
    values (
        v_bet_id,
        p_choice_id,
        v_user_id,
        p_stake,
        v_potential_win
    )
    returning * into v_stake;

    return v_stake;

end;
$function$;


CREATE OR REPLACE FUNCTION public.mission_eval(p_user uuid, p_group uuid, p_mission text, OUT progress numeric, OUT target numeric, OUT keys text[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          -- Carte rouge : 2 h avant pour un pari classique, dès la publication pour un pari court.
          and (public.bet_close_interval(b.created_at, b.deadline_at) < interval '1 hour'
               or s.created_at >= b.deadline_at - 2 * public.bet_close_interval(b.created_at, b.deadline_at))
          and s.created_at < b.deadline_at - public.bet_close_interval(b.created_at, b.deadline_at);

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
$function$;
