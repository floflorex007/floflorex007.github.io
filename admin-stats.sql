-- =========================================================
-- BetLab : l'admin voit et modifie les stats de tous les joueurs
--
-- - XP (commune à tous les groupes) : l'XP est calculée à partir des mises ;
--   l'admin la règle grâce à un ajustement (profiles.xp_bonus) ajouté au calcul.
-- - Série de flammes (commune à tous les groupes) : profiles.streak_days.
-- - Solde et points : par groupe (group_members).
--
-- À lancer après xp-par-mise.sql, serie-protection.sql et admin-soldes.sql.
-- =========================================================


-- Ajustement d'XP décidé par l'admin (positif ou négatif).
alter table public.profiles
    add column if not exists xp_bonus integer not null default 0;


-- Les joueurs ne peuvent pas changer eux-mêmes leur ajustement d'XP.
create or replace function public.protect_profile_xp()
returns trigger
language plpgsql
as $$
begin

    if coalesce(current_setting('betlab.allow_points', true), '') <> 'on'
        and new.xp_bonus is distinct from old.xp_bonus
    then
        raise exception 'L''XP ne peut pas être modifiée directement.';
    end if;

    return new;

end;
$$;

drop trigger if exists protect_profile_xp on public.profiles;

create trigger protect_profile_xp
    before update on public.profiles
    for each row execute function public.protect_profile_xp();


-- XP d'un joueur : mises (depuis la dernière remise à zéro), paris gagnés, ajustement admin.
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
        (select coalesce(sum(stake_xp(stake)), 0)
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
        + coalesce((select xp_bonus from profiles where id = p_user), 0)
    ))::integer;
$$;

revoke all on function public.player_xp_of(uuid) from public, anon, authenticated;


-- Mon XP (utilisée par le site) : même calcul, ajustement compris.
create or replace function public.player_xp()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select public.player_xp_of(auth.uid());
$$;


-- Toutes les stats, groupe par groupe (un joueur apparaît dans chacun de ses groupes).
create or replace function public.admin_list_stats()
returns table (
    group_id uuid,
    group_name text,
    user_id uuid,
    username text,
    balance numeric,
    points integer,
    streak_days integer,
    xp integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    return query
        select g.id, g.name, p.id, p.username, gm.balance, gm.points::integer,
               coalesce(p.streak_days, 0), public.player_xp_of(p.id)
        from group_members gm
        join groups g on g.id = gm.group_id
        join profiles p on p.id = gm.user_id
        where not p.is_admin
        order by g.name, p.username;

end;
$$;


-- Modifie les stats d'un joueur. Le solde et les points concernent le groupe choisi ;
-- l'XP et la série sont communes à tous ses groupes.
create or replace function public.admin_set_stats(
    p_group uuid,
    p_user uuid,
    p_balance numeric,
    p_points integer,
    p_streak integer,
    p_xp integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_current integer;
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    if p_balance is null or p_balance < 0
        or p_points is null or p_points < 0
        or p_streak is null or p_streak < 0
        or p_xp is null or p_xp < 0
    then
        raise exception 'Les valeurs doivent être positives.';
    end if;

    update group_members
    set balance = round(p_balance),
        points = p_points
    where group_id = p_group
      and user_id = p_user;

    if not found then
        raise exception 'Ce joueur ne fait pas partie de ce groupe.';
    end if;

    -- XP voulue : l'ajustement compense la différence avec l'XP calculée.
    v_current := public.player_xp_of(p_user);

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set xp_bonus = xp_bonus + (p_xp - v_current)
    where id = p_user;

    -- Série : la valeur est celle du jour (le joueur gagnera +1 demain).
    if p_streak is distinct from (select streak_days from profiles where id = p_user) then

        update profiles
        set streak_days = p_streak,
            last_checkin = case when p_streak > 0 then v_today else last_checkin end,
            streak_lost = 0,
            streak_lost_day = null
        where id = p_user;

    end if;

    perform set_config('betlab.allow_points', 'off', true);

end;
$$;
