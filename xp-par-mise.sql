-- =========================================================
-- BetLab : XP gagnée selon le montant de la mise
--
--   10 €    →  1 XP
--   proportionnel jusqu'à 100 € → 10 XP
--   de 100 € à 1 000 € : de 10 XP à 20 XP (progressif)
--   1 000 € et plus : 20 XP par mise
--
-- Le bonus « pari gagné » (+25 XP) ne change pas.
-- À lancer une seule fois (remplace le « 10 XP par mise »).
-- =========================================================

create or replace function public.stake_xp(p_stake numeric)
returns numeric
language sql
immutable
as $$
    select case
        when p_stake is null or p_stake <= 0 then 0
        when p_stake <= 100 then p_stake / 10
        when p_stake <= 1000 then 10 + (p_stake - 100) / 90
        else 20
    end;
$$;


create or replace function public.player_xp()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    with reset as (
        select coalesce(
            (select value from app_settings where key = 'xp_reset_at'),
            '-infinity'::timestamptz
        ) as at
    )
    select round(
        (select coalesce(sum(stake_xp(stake)), 0)
         from stakes, reset
         where user_id = auth.uid()
           and created_at >= reset.at)
        + (select count(*) * 25
           from stakes s
           join bets b on b.id = s.bet_id
           cross join reset
           where s.user_id = auth.uid()
             and s.created_at >= reset.at
             and b.status = 'resolved'
             and b.winner_choice_id = s.choice_id)
    )::integer;
$$;
