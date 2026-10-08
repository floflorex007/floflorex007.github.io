-- =========================================================
-- BetLab : le créateur d'un pari peut de nouveau miser dessus
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal.
--
-- Annule createur-sans-mise.sql : place_bet est reprise telle
-- qu'elle est en base (2026-10-08), seul le refus du créateur
-- est retiré. Le créateur suit les mêmes règles que les autres
-- (1 mise par pari, mise max, échéance).
-- Sa commission ne compte toujours pas ses propres mises
-- (creatorCommission() dans app.js, resolve_bet en base).
-- =========================================================


create or replace function public.place_bet(p_choice_id uuid, p_stake numeric)
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


    select bc.bet_id, bc.odds, b.group_id, b.created_at, b.deadline_at, b.author_id
    into v_bet_id, v_odds, v_group_id, v_created_at, v_deadline_at, v_author_id
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
          and user_id = v_user_id) >= 1
    then
        raise exception 'Tu as déjà misé sur ce pari (1 seule mise par pari)';
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
