-- =========================================================
-- BetLab : mise max qui baisse avec le temps
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal.
--
--   - pendant la 1re minute du pari : mise max 5 000 € ;
--   - puis baisse linéaire ;
--   - pendant la dernière minute avant la fermeture des mises
--     (échéance − bet_close_interval) : mise max 10 €.
--
-- Même calcul côté site : betMaxStake() dans app.js.
-- place_bet est reprise telle qu'elle est en base (2026-10-07),
-- seule la vérification de la mise max du moment est ajoutée.
-- 10 secondes de marge : le joueur a pu cliquer un peu avant
-- que la base ne reçoive sa mise.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Mise max d'un pari à un instant donné
-- ---------------------------------------------------------

create or replace function public.bet_max_stake(
    p_created_at timestamptz,
    p_deadline_at timestamptz,
    p_at timestamptz default now()
)
returns numeric
language plpgsql
stable
as $$
declare
    v_start timestamptz;
    v_end timestamptz;
    v_ratio numeric;
begin

    -- Pas d'échéance : pas de baisse.
    if p_created_at is null or p_deadline_at is null then
        return 5000;
    end if;

    v_start := p_created_at + interval '1 minute';

    v_end := p_deadline_at
        - public.bet_close_interval(p_created_at, p_deadline_at)
        - interval '1 minute';

    if p_at <= v_start then
        return 5000;
    end if;

    if p_at >= v_end then
        return 10;
    end if;

    v_ratio := extract(epoch from (p_at - v_start))
             / extract(epoch from (v_end - v_start));

    return greatest(10, floor(5000 - (5000 - 10) * v_ratio));

end;
$$;


-- ---------------------------------------------------------
-- 2. place_bet : refuse une mise au-dessus de la mise max du moment
-- ---------------------------------------------------------

create or replace function public.place_bet(p_choice_id uuid, p_stake numeric)
returns public.stakes
language plpgsql
security definer
set search_path to 'public'
as $$
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


    select bc.bet_id, bc.odds, b.group_id, b.created_at, b.deadline_at
    into v_bet_id, v_odds, v_group_id, v_created_at, v_deadline_at
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


    -- Mise max du moment (10 s de marge pour le temps de trajet de la mise).
    v_max := public.bet_max_stake(v_created_at, v_deadline_at, now() - interval '10 seconds');

    if p_stake > v_max then
        raise exception 'Mise max en ce moment : % € (elle baisse avec le temps)', v_max;
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
$$;
