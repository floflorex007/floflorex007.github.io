-- =========================================================
-- BetLab : l'admin supprime des paris de l'historique (2026-10-14)
--
-- Choix de l'utilisateur : on ne touche PAS aux soldes.
-- Le pari disparaît de l'historique de tout le monde (choix, mises,
-- contestation, commission), mais l'argent déjà gagné ou perdu reste.
--
-- Seulement les paris terminés (validés ou annulés), et refusé si :
--   - un gagnant n'a pas encore récupéré son gain (il le perdrait) ;
--   - une contestation est en cours ;
--   - un combiné qui le contient n'est pas fini (en cours, ou gagné
--     mais pas encore récupéré) : retirer le pari changerait son résultat.
-- Les combinés finis qui le contiennent sont supprimés avec lui
-- (sinon un combiné perdu à cause de ce pari deviendrait gagnant).
--
-- À lancer après admin-annulation.sql et combines.sql.
-- =========================================================


-- Raison pour laquelle un pari ne peut pas être supprimé (null = possible).
create or replace function public.bet_delete_blocker(p_bet_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when b.status not in ('resolved', 'cancelled')
            then 'Pari pas encore terminé.'
        when exists (
            select 1 from bet_contests c
            where c.bet_id = b.id and c.status = 'open'
        )
            then 'Contestation en cours.'
        when exists (
            select 1 from stakes s
            where s.bet_id = b.id
              and b.status = 'resolved'
              and s.choice_id = b.winner_choice_id
              and s.claimed_at is null
        )
            then 'Un gagnant n''a pas encore récupéré son gain.'
        when exists (
            select 1 from combo_legs l
            join combos c on c.id = l.combo_id
            where l.bet_id = b.id
              and c.claimed_at is null
              and (select status from combo_state(c.id)) <> 'lost'
        )
            then 'Dans un combiné pas encore fini.'
        else null
    end
    from bets b
    where b.id = p_bet_id;
$$;

revoke all on function public.bet_delete_blocker(uuid) from public, anon;


create or replace function public.admin_list_finished_bets()
returns table (
    bet_id uuid,
    group_id uuid,
    group_name text,
    question text,
    status text,
    finished_at timestamptz,
    author_name text,
    players bigint,
    total_staked numeric,
    combos bigint,
    blocker text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    return query
    select
        b.id,
        b.group_id,
        g.name,
        b.question,
        b.status,
        coalesce(b.resolved_at, b.deadline_at, b.created_at),
        p.username,
        (select count(distinct s.user_id) from stakes s where s.bet_id = b.id),
        (select coalesce(sum(s.stake), 0) from stakes s where s.bet_id = b.id),
        (select count(*) from combo_legs l where l.bet_id = b.id),
        bet_delete_blocker(b.id)
    from bets b
    join groups g on g.id = b.group_id
    left join profiles p on p.id = b.author_id
    where b.status in ('resolved', 'cancelled')
    order by coalesce(b.resolved_at, b.deadline_at, b.created_at) desc;
end;
$$;

revoke all on function public.admin_list_finished_bets() from public, anon;
grant execute on function public.admin_list_finished_bets() to authenticated;


create or replace function public.admin_delete_bet(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_blocker text;
begin
    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Seul l''admin peut supprimer un pari.';
    end if;

    perform 1 from bets where id = p_bet_id for update;

    if not found then
        raise exception 'Pari introuvable.';
    end if;

    v_blocker := bet_delete_blocker(p_bet_id);

    if v_blocker is not null then
        raise exception 'Suppression impossible : %', v_blocker;
    end if;

    -- L'XP est calculée à partir des mises (player_xp_of) : on garde celle
    -- que ce pari a rapportée dans profiles.xp_bonus, pour que l'XP ne baisse pas.
    perform set_config('betlab.allow_points', 'on', true);

    update profiles p
    set xp_bonus = coalesce(p.xp_bonus, 0) + round(x.xp)::integer
    from (
        select s.user_id,
               sum(stake_xp(s.stake))
               + 25 * count(*) filter (where b.status = 'resolved' and b.winner_choice_id = s.choice_id) as xp
        from stakes s
        join bets b on b.id = s.bet_id
        where s.bet_id = p_bet_id
          and s.created_at >= coalesce(
              (select value from app_settings where key = 'xp_reset_at'),
              '-infinity'::timestamptz
          )
        group by s.user_id
    ) x
    where p.id = x.user_id;

    perform set_config('betlab.allow_points', 'off', true);

    -- Combinés finis qui le contiennent : supprimés avec lui (soldes inchangés).
    delete from combos c
    where exists (select 1 from combo_legs l where l.combo_id = c.id and l.bet_id = p_bet_id);

    -- Choix, mises, contestation, commission… suivent (on delete cascade).
    delete from bets where id = p_bet_id;
end;
$$;

revoke all on function public.admin_delete_bet(uuid) from public, anon;
grant execute on function public.admin_delete_bet(uuid) to authenticated;
