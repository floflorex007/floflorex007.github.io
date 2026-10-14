-- =========================================================
-- BetLab : contester un pari sans avoir misé dessus (2026-10-14)
--
-- Avant : seuls les joueurs qui avaient misé pouvaient contester.
-- Maintenant : tout membre du groupe (sauf le créateur), pendant
-- les 24 h après la validation, une seule contestation par pari.
-- Le site montre ces paris dans l'Historique (filtre « Autres paris »).
--
-- Celui qui conteste ne fait plus partie du jury (sinon un joueur
-- neutre qui conteste voterait pour sa propre contestation).
-- Le reste du vote est inchangé (contestations.sql, afk.sql).
-- =========================================================


CREATE OR REPLACE FUNCTION public.open_contest(p_bet_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
    v_bet record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select * into v_bet
    from bets
    where id = p_bet_id
    for update;

    if v_bet is null or v_bet.status <> 'resolved' then
        raise exception 'On ne peut contester qu''un pari validé.';
    end if;

    if v_bet.author_id = v_user then
        raise exception 'Tu ne peux pas contester ton propre pari.';
    end if;

    if v_bet.resolved_at is null or now() > v_bet.resolved_at + interval '24 hours' then
        raise exception 'Trop tard : on peut contester pendant 24 h après la validation.';
    end if;

    -- Tout membre du groupe peut contester, même sans avoir misé (2026-10-14).
    if not is_group_member(v_bet.group_id) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if exists (select 1 from bet_contests where bet_id = p_bet_id) then
        raise exception 'Ce pari a déjà été contesté.';
    end if;

    insert into bet_contests (bet_id, group_id, opened_by, reason, ends_at)
    values (
        p_bet_id,
        v_bet.group_id,
        v_user,
        nullif(left(trim(coalesce(p_reason, '')), 200), ''),
        now() + interval '24 hours'
    );

end;
$function$;


CREATE OR REPLACE FUNCTION public.contest_jury(p_bet_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with b as (
        select group_id, author_id from bets where id = p_bet_id
    ),
    members as (
        select gm.user_id
        from group_members gm
        join b on gm.group_id = b.group_id
        join profiles p on p.id = gm.user_id
        where gm.user_id <> b.author_id
          -- Celui qui conteste ne fait pas partie du jury (2026-10-14).
          and gm.user_id is distinct from (select c.opened_by from bet_contests c where c.bet_id = p_bet_id)
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
$function$;
