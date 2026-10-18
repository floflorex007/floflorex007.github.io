-- =========================================================
-- BetLab : la flamme bleue (victoires d'affilée) booste la cote
--
-- Mise simple : la cote est augmentée selon la série de victoires
-- d'affilée du joueur dans le groupe (même calcul que la flamme
-- bleue du classement, voir duels.sql) :
--   3 à 4 victoires  → +5 %
--   5 à 7            → +10 %
--   8 à 11           → +15 %
--   12 et plus       → +20 %
-- Se cumule avec le boost WTF. Les combinés gardent leur propre boost.
--
-- Remplace place_bet. À lancer après duels.sql.
-- =========================================================


-- Série de victoires d'affilée d'un joueur dans un groupe (mises simples et combinés validés).
create or replace function public.win_streak_of(p_group uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    with events as (
        select b.resolved_at as at, s.choice_id = b.winner_choice_id as win
        from stakes s
        join bets b on b.id = s.bet_id
        where b.group_id = p_group
          and b.status = 'resolved'
          and s.user_id = p_user
        union all
        select (select max(b.resolved_at) from combo_legs l join bets b on b.id = l.bet_id where l.combo_id = c.id),
               st.status = 'won'
        from combos c
        cross join lateral combo_state(c.id) st
        where c.group_id = p_group
          and c.user_id = p_user
          and st.status in ('won', 'lost')
    ),
    ranked as (
        select win, row_number() over (order by at desc nulls last) as rn
        from events
    )
    select coalesce(min(rn) filter (where not win) - 1, count(*))::integer
    from ranked;
$$;


-- Boost de cote selon la série (0 sous 3 victoires).
create or replace function public.win_streak_boost(p_streak integer)
returns numeric
language sql
immutable
as $$
    select case
        when p_streak >= 12 then 0.20
        when p_streak >= 8 then 0.15
        when p_streak >= 5 then 0.10
        when p_streak >= 3 then 0.05
        else 0
    end;
$$;


CREATE OR REPLACE FUNCTION public.place_bet(p_choice_id uuid, p_stake numeric, p_odds numeric DEFAULT NULL::numeric, p_boost boolean DEFAULT false)
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
    v_created_at timestamptz;
    v_deadline_at timestamptz;
    v_max numeric;
    v_author_id uuid;
    v_status text;
begin

    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Utilisateur non connectÃ©';
    end if;


    if p_stake is null or p_stake <= 0 then
        raise exception 'La mise doit Ãªtre supÃ©rieure Ã  0';
    end if;

    if p_stake <> trunc(p_stake) then
        raise exception 'La mise doit Ãªtre un montant rond (sans centimes)';
    end if;

    if p_stake < 10 or p_stake > 5000 then
        raise exception 'La mise doit Ãªtre comprise entre 10 â‚¬ et 5 000 â‚¬';
    end if;


    select bc.bet_id, bc.odds, b.group_id, b.created_at, b.deadline_at, b.author_id, b.status
    into v_bet_id, v_odds, v_group_id, v_created_at, v_deadline_at, v_author_id, v_status
    from public.bet_choices bc
    join public.bets b
        on b.id = bc.bet_id
    where bc.id = p_choice_id
      and b.status in ('open', 'draft')
    for update of b;

    if v_bet_id is null then
        raise exception 'Ce pari n''est plus disponible';
    end if;

    -- Cotes qui bougent : la cote a pu changer depuis l'affichage.
    if p_odds is not null and abs(v_odds - p_odds) >= 0.005 then
        raise exception 'La cote a changÃ© : % â†’ %. VÃ©rifie et mise Ã  nouveau.',
            replace(to_char(p_odds, 'FM990.00'), '.', ','),
            replace(to_char(v_odds, 'FM990.00'), '.', ',');
    end if;

    -- Brouillon : seul son crÃ©ateur peut miser (et sa mise le publie).
    if v_status = 'draft' then

        if v_author_id is distinct from v_user_id then
            raise exception 'Ce pari n''est plus disponible';
        end if;

        v_created_at := now();

    end if;


    if v_deadline_at is not null
       and now() >= v_deadline_at - public.bet_close_interval(v_created_at, v_deadline_at)
    then
        raise exception 'Les mises sont closes (Ã©chÃ©ance trop proche)';
    end if;


    -- Mise max du moment (10 s de marge pour le temps de trajet de la mise).
    v_max := public.bet_max_stake(v_created_at, v_deadline_at, now() - interval '10 seconds');

    if p_stake > v_max then
        raise exception 'Mise max en ce moment : % â‚¬ (elle baisse avec le temps)', v_max;
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

    -- Le solde est verrouillÃ© : deux mises simultanÃ©es ne peuvent pas dÃ©passer la limite.
    if (select count(*) from public.stakes
        where bet_id = v_bet_id
          and user_id = v_user_id) >= 1
    then
        raise exception 'Tu as dÃ©jÃ  misÃ© sur ce pari (1 seule mise par pari)';
    end if;

    if v_balance < p_stake then
        raise exception 'Solde insuffisant';
    end if;

    -- Boost WTF : vÃ©rifiÃ© aprÃ¨s le verrou du solde (un seul boost par semaine).
    if p_boost and not public.boost_available(v_group_id, v_user_id) then
        raise exception 'Tu n''as plus de boost cette semaine : le prochain arrive lundi.';
    end if;


    -- Flamme bleue : série de victoires d'affilée = boost de cote (voir win_streak_boost).
    v_potential_win := round(
        p_stake * v_odds
        * (case when p_boost then 1.2 else 1 end)
        * (1 + public.win_streak_boost(public.win_streak_of(v_group_id, v_user_id))),
        2
    );


    update public.group_members
    set balance = balance - p_stake
    where group_id = v_group_id
      and user_id = v_user_id;


    insert into public.stakes (
        bet_id,
        choice_id,
        user_id,
        stake,
        potential_win,
        boosted
    )
    values (
        v_bet_id,
        p_choice_id,
        v_user_id,
        p_stake,
        v_potential_win,
        coalesce(p_boost, false)
    )
    returning * into v_stake;


    -- Publication : le pari arrive chez tout le monde avec la mise du crÃ©ateur.
    if v_status = 'draft' then

        update public.bets
        set status = 'open',
            created_at = v_created_at
        where id = v_bet_id;

    end if;

    return v_stake;

end;
$function$;
