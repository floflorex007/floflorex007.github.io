-- =========================================================
-- BetLab : +5 XP par mise, +10 XP pour le créateur quand il valide son pari
--
--   - mises : +5 XP chacune, quel que soit le montant. Seulement pour les
--     mises faites après le lancement de ce script (app_settings
--     'xp_flat_since') : les anciennes gardent leur XP, personne ne perd de niveau.
--     L'XP de groupe (arbre) garde stake_xp, elle ne change pas.
--   - compté pour chaque pari validé (status = 'resolved') dont on est l'auteur
--   - un pari annulé par le jury (contestation) ne compte plus : l'XP repart
--   - Try hard : +50 % le lundi, comme les autres XP
--   - suppression d'historique (admin) : l'XP gardée dans xp_bonus
--
-- Remplace player_xp_of (arbre-palier1.sql) et admin_delete_bet
-- (admin-suppression-historique.sql). À lancer après eux.
-- =========================================================


insert into app_settings (key, value)
values ('xp_flat_since', now())
on conflict (key) do nothing;


-- XP d'une mise : 5, ou l'ancien barème (stake_xp) avant le changement.
create or replace function public.player_stake_xp(p_stake numeric, p_created_at timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
    select case
        when p_created_at >= coalesce(
            (select value from app_settings where key = 'xp_flat_since'),
            'infinity'::timestamptz
        ) then 5
        else stake_xp(p_stake)
    end;
$$;

revoke all on function public.player_stake_xp(numeric, timestamptz) from public, anon, authenticated;


create or replace function public.player_xp_of(p_user uuid)
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
    select greatest(0, round(
        (select coalesce(sum(player_stake_xp(stake, created_at)), 0)
         from stakes, reset
         where user_id = p_user
           and created_at >= reset.at)
        + (select count(*) * 25
           from stakes s
           join bets b on b.id = s.bet_id
           cross join reset
           where s.user_id = p_user
             and s.created_at >= reset.at
             and b.status = 'resolved'
             and b.winner_choice_id = s.choice_id)
        -- Paris validés par leur créateur : +10 XP chacun.
        + (select count(*) * 10
           from bets b
           cross join reset
           where b.author_id = p_user
             and b.status = 'resolved'
             and b.resolved_at >= reset.at)
        -- Try hard : la moitié en plus pour les mises du lundi et les paris gagnés résolus un lundi.
        + (select coalesce(sum(
               case when extract(isodow from s.created_at at time zone 'Europe/Paris') = 1
                    then player_stake_xp(s.stake, s.created_at) * 0.5 else 0 end
             + case when b.status = 'resolved'
                     and b.winner_choice_id = s.choice_id
                     and extract(isodow from b.resolved_at at time zone 'Europe/Paris') = 1
                    then 25 * 0.5 else 0 end
           ), 0)
           from stakes s
           join bets b on b.id = s.bet_id
           cross join reset
           where s.user_id = p_user
             and s.created_at >= reset.at
             and s.created_at >= public.tree_node_since(b.group_id, 't'))
        -- Try hard : validation un lundi.
        + (select count(*) * 10 * 0.5
           from bets b
           cross join reset
           where b.author_id = p_user
             and b.status = 'resolved'
             and b.resolved_at >= reset.at
             and b.resolved_at >= public.tree_node_since(b.group_id, 't')
             and extract(isodow from b.resolved_at at time zone 'Europe/Paris') = 1)
        + coalesce((select xp_bonus from profiles where id = p_user), 0)
    ))::integer;
$$;

revoke all on function public.player_xp_of(uuid) from public, anon, authenticated;


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
               sum(player_stake_xp(s.stake, s.created_at))
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

    -- Les +10 XP de validation du créateur sont gardés aussi.
    update profiles p
    set xp_bonus = coalesce(p.xp_bonus, 0) + 10
    from bets b
    where b.id = p_bet_id
      and p.id = b.author_id
      and b.status = 'resolved'
      and b.resolved_at >= coalesce(
          (select value from app_settings where key = 'xp_reset_at'),
          '-infinity'::timestamptz
      );

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
