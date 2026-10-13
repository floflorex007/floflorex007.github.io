-- =========================================================
-- BetLab : liste des joueurs qui peuvent voter (2026-10-13)
--
-- À lancer après contestations.sql et afk.sql.
--
-- contest_jury_names(p_bet_id) : pseudos du jury d'une contestation,
-- avec « a déjà voté » ou non (le sens du vote reste secret).
--   - vote en cours : le jury actuel (contest_jury) ;
--   - vote terminé : ceux qui ont voté.
-- Réservé aux membres du groupe du pari.
-- =========================================================


create or replace function public.contest_jury_names(p_bet_id uuid)
returns table (username text, voted boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_contest record;
begin

    select c.* into v_contest
    from bet_contests c
    where c.bet_id = p_bet_id;

    if v_contest is null then
        return;
    end if;

    if not exists (
        select 1 from group_members
        where group_id = v_contest.group_id
          and user_id = v_user
    ) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if v_contest.status = 'open' then

        return query
        select p.username, exists (
                   select 1 from bet_contest_votes v
                   where v.bet_id = p_bet_id
                     and v.user_id = j.user_id
               )
        from contest_jury(p_bet_id) j
        join profiles p on p.id = j.user_id
        order by 2 desc, lower(p.username);

    else

        return query
        select p.username, true
        from bet_contest_votes v
        join profiles p on p.id = v.user_id
        where v.bet_id = p_bet_id
        order by lower(p.username);

    end if;

end;
$$;

grant execute on function public.contest_jury_names(uuid) to authenticated;
