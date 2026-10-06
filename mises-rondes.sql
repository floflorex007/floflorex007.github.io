-- =========================================================
-- BetLab : les mises doivent être des montants ronds
--
-- Réécrit place_bet (l'originale n'était pas dans le dépôt) :
--   - la mise doit être un nombre entier d'euros ;
--   - le gain potentiel est arrondi à 2 décimales
--     (plus de chiffres parasites dans les soldes).
-- Le reste ne change pas.
-- =========================================================

create or replace function public.place_bet(p_choice_id uuid, p_stake numeric)
returns stakes
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_balance numeric;
    v_bet_id uuid;
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


    select bc.bet_id, bc.odds
    into v_bet_id, v_odds
    from public.bet_choices bc
    join public.bets b
        on b.id = bc.bet_id
    where bc.id = p_choice_id
      and b.status = 'open';

    if v_bet_id is null then
        raise exception 'Ce pari n''est plus disponible';
    end if;


    select balance
    into v_balance
    from public.profiles
    where id = v_user_id
    for update;

    if v_balance is null then
        raise exception 'Profil utilisateur introuvable';
    end if;

    if v_balance < p_stake then
        raise exception 'Solde insuffisant';
    end if;


    v_potential_win := round(p_stake * v_odds, 2);


    update public.profiles
    set balance = balance - p_stake
    where id = v_user_id;


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
