-- =========================================================
-- BetLab : joueurs AFK (absents)
--
-- Un joueur est AFK s'il n'est pas venu sur le site pendant 2 jours
-- ouvrés de suite (le samedi et le dimanche ne comptent pas).
-- Sa dernière visite est profiles.last_checkin (connexion du jour,
-- enregistrée à chaque ouverture du site).
--
-- Les joueurs AFK ne font plus partie du jury des contestations.
-- Dès qu'ils reviennent sur le site, ils y retrouvent leur place.
-- Un vote déjà donné compte toujours, même si le joueur devient AFK.
--
-- À lancer après contestations.sql et combines.sql.
-- =========================================================


-- Jours ouvrés (lundi → vendredi) manqués depuis la dernière visite,
-- sans compter aujourd'hui (la journée n'est pas finie).
create or replace function public.is_afk(p_last_checkin date)
returns boolean
language sql
stable
set search_path = public
as $$
    select p_last_checkin is null
        or (
            select count(*)
            from generate_series(
                p_last_checkin + 1,
                (now() at time zone 'Europe/Paris')::date - 1,
                interval '1 day'
            ) as day
            where extract(isodow from day) < 6
        ) >= 2;
$$;


-- Jury d'une contestation : membres du groupe hors créateur et admin,
-- sans les AFK (sauf s'ils ont déjà voté). Seuls les neutres votent,
-- ou tous ces membres s'il n'y a aucun neutre.
create or replace function public.contest_jury(p_bet_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
    with b as (
        select group_id, author_id from bets where id = p_bet_id
    ),
    members as (
        select gm.user_id
        from group_members gm
        join b on gm.group_id = b.group_id
        join profiles p on p.id = gm.user_id
        where gm.user_id <> b.author_id
          and not coalesce(p.is_admin, false)
          and (
              not public.is_afk(p.last_checkin)
              or exists (
                  select 1 from bet_contest_votes v
                  where v.bet_id = p_bet_id
                    and v.user_id = gm.user_id
              )
          )
    ),
    neutral as (
        select m.user_id
        from members m
        where not exists (
            select 1 from stakes s
            where s.bet_id = p_bet_id
              and s.user_id = m.user_id
        )
        and not exists (
            select 1 from combo_legs l
            join combos c on c.id = l.combo_id
            where l.bet_id = p_bet_id
              and c.user_id = m.user_id
        )
    )
    select user_id from neutral
    union all
    select user_id from members
    where not exists (select 1 from neutral);
$$;
