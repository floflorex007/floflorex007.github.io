-- =========================================================
-- BetLab : cotes qui bougent — la 1re mise du créateur ne compte pas
-- (2026-10-14, à lancer après cotes-mouvantes.sql)
--
-- La mise qui publie le pari (1re mise du créateur sur son pari,
-- simple ou combiné) ne fait pas bouger les cotes : le pari arrive
-- chez tout le monde avec les cotes de départ fixées par le créateur.
-- Ses mises suivantes (combinés) comptent normalement.
-- =========================================================


create or replace function public.recompute_bet_odds(p_bet uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_liquidity constant numeric := 10000;
    v_author uuid;
    v_skip_stake uuid;
    v_skip_combo uuid;
begin
    select author_id into v_author
    from bets
    where id = p_bet and dynamic_odds;

    if not found then
        return;
    end if;

    -- 1re mise du créateur sur ce pari (simple ou combiné) : ignorée.
    select f.stake_id, f.combo_id
    into v_skip_stake, v_skip_combo
    from (
        select s.id as stake_id, null::uuid as combo_id, s.created_at
        from stakes s
        where s.bet_id = p_bet and s.user_id = v_author
        union all
        select null, co.id, co.created_at
        from combos co
        join combo_legs l on l.combo_id = co.id
        where l.bet_id = p_bet and co.user_id = v_author
    ) f
    order by f.created_at
    limit 1;

    with c as (
        select bc.id,
               1 / bc.start_odds as inv,
               coalesce((select sum(s.stake) from stakes s
                         where s.choice_id = bc.id
                           and s.id is distinct from v_skip_stake), 0)
             + coalesce((select sum(co.stake) from combo_legs l join combos co on co.id = l.combo_id
                         where l.choice_id = bc.id
                           and co.id is distinct from v_skip_combo), 0) as staked
        from bet_choices bc
        where bc.bet_id = p_bet
    ),
    pots as (
        select id, v_liquidity * inv / sum(inv) over () + staked as pot
        from c
    ),
    calc as (
        select id, least(10, greatest(1.01, round(sum(pot) over () / pot, 2))) as odds
        from pots
    )
    update bet_choices bc
    set odds = calc.odds
    from calc
    where bc.id = calc.id
      and bc.odds is distinct from calc.odds;
end;
$$;

revoke all on function public.recompute_bet_odds(uuid) from public, anon, authenticated;


-- Paris déjà créés avec des cotes qui bougent : recalculés avec la nouvelle règle.
select public.recompute_bet_odds(id) from public.bets where dynamic_odds;
