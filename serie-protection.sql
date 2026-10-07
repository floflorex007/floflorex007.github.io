-- =========================================================
-- BetLab : protéger sa série de connexions
--
-- Bouclier de série (boutique, 40 points, 3 maximum) : un bouclier
-- est utilisé automatiquement pour chaque jour manqué.
-- Rattrapage 24 h (60 points) : après un seul jour manqué sans
-- bouclier, la série perdue peut être récupérée jusqu'à minuit.
--
-- À lancer après groupes-progression.sql.
-- =========================================================

alter table public.profiles
    add column if not exists streak_shields integer not null default 0,
    add column if not exists streak_lost integer not null default 0,
    add column if not exists streak_lost_day date;


-- Les nouvelles colonnes sont protégées comme le reste de la progression.
create or replace function public.protect_profile_progress()
returns trigger
language plpgsql
as $$
begin

    if coalesce(current_setting('betlab.allow_points', true), '') <> 'on'
        and (
            new.streak_days is distinct from old.streak_days
            or new.last_checkin is distinct from old.last_checkin
            or new.last_chest is distinct from old.last_chest
            or new.streak_shields is distinct from old.streak_shields
            or new.streak_lost is distinct from old.streak_lost
            or new.streak_lost_day is distinct from old.streak_lost_day
        )
    then
        raise exception 'La progression ne peut pas être modifiée directement.';
    end if;

    return new;

end;
$$;


drop function if exists public.daily_checkin(uuid);

create function public.daily_checkin(
    p_group uuid,
    out streak integer,
    out increased boolean,
    out chest_available boolean,
    out shields integer,
    out shield_used integer,
    out can_restore boolean,
    out lost_streak integer
)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_profile record;
    v_last_chest date;
    v_missed integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select streak_days, last_checkin, is_admin, streak_shields, streak_lost, streak_lost_day
    into v_profile
    from profiles
    where id = v_user
    for update;

    increased := v_profile.last_checkin is distinct from v_today;

    shields := v_profile.streak_shields;
    shield_used := 0;
    lost_streak := v_profile.streak_lost;

    perform set_config('betlab.allow_points', 'on', true);

    if increased then

        v_missed := case
            when v_profile.last_checkin is null then null
            else v_today - v_profile.last_checkin - 1
        end;

        if v_missed = 0 then

            streak := v_profile.streak_days + 1;

        elsif v_missed > 0 and v_profile.streak_days > 0 and shields >= v_missed then

            -- Un bouclier par jour manqué : la série continue.
            shield_used := v_missed;
            shields := shields - v_missed;
            streak := v_profile.streak_days + 1;

        else

            streak := 1;

            -- Un seul jour manqué : la série perdue peut être rattrapée aujourd'hui.
            if v_missed = 1 and v_profile.streak_days > 1 then
                lost_streak := v_profile.streak_days;
            else
                lost_streak := 0;
            end if;

        end if;

        update profiles
        set streak_days = streak,
            last_checkin = v_today,
            streak_shields = shields,
            streak_lost = lost_streak,
            streak_lost_day = case when lost_streak > 0 then v_today else null end
        where id = v_user;

        can_restore := lost_streak > 0;

    else

        streak := v_profile.streak_days;

        can_restore := v_profile.streak_lost > 0 and v_profile.streak_lost_day = v_today;

    end if;

    perform set_config('betlab.allow_points', 'off', true);

    if not can_restore then
        lost_streak := 0;
    end if;

    select last_chest into v_last_chest
    from group_members
    where group_id = p_group
      and user_id = v_user;

    -- L'administrateur peut ouvrir le coffre sans limite.
    chest_available := found
        and (v_last_chest is distinct from v_today or v_profile.is_admin);

end;
$$;


-- Achat d'un bouclier avec les points du groupe en cours.
create or replace function public.buy_streak_shield(p_group uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_price constant integer := 40;
    v_points integer;
    v_shields integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select points into v_points
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select streak_shields into v_shields
    from profiles
    where id = v_user
    for update;

    if v_shields >= 3 then
        raise exception 'Tu as déjà 3 boucliers (maximum).';
    end if;

    if v_points < v_price then
        raise exception 'Il te manque % points.', v_price - v_points;
    end if;

    update group_members
    set points = points - v_price
    where group_id = p_group
      and user_id = v_user;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set streak_shields = streak_shields + 1
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

    return v_shields + 1;

end;
$$;


-- Rattrapage : récupère la série perdue (le jour même), avec les points du groupe.
create or replace function public.restore_streak(p_group uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_price constant integer := 60;
    v_points integer;
    v_profile record;
    v_streak integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select points into v_points
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select streak_days, streak_lost, streak_lost_day into v_profile
    from profiles
    where id = v_user
    for update;

    if v_profile.streak_lost <= 0 or v_profile.streak_lost_day is distinct from v_today then
        raise exception 'Aucune série à rattraper aujourd''hui.';
    end if;

    if v_points < v_price then
        raise exception 'Il te manque % points.', v_price - v_points;
    end if;

    update group_members
    set points = points - v_price
    where group_id = p_group
      and user_id = v_user;

    -- La série reprend là où elle s'était arrêtée, plus aujourd'hui.
    v_streak := v_profile.streak_lost + v_profile.streak_days;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set streak_days = v_streak,
        streak_lost = 0,
        streak_lost_day = null
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

    return v_streak;

end;
$$;
