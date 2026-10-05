-- =========================================================
--   BETLAB : SÉRIE DE CONNEXIONS, COFFRE QUOTIDIEN, XP
--   À coller dans Supabase → SQL Editor → Run
--   (après missions.sql). Le script peut être relancé sans risque.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Colonnes ajoutées aux profils
-- ---------------------------------------------------------

alter table public.profiles
    add column if not exists streak_days integer not null default 0,
    add column if not exists last_checkin date,
    add column if not exists last_chest date;


-- ---------------------------------------------------------
-- 2. Protection : ces colonnes ne changent que
--    par les fonctions ci-dessous.
-- ---------------------------------------------------------

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
        )
    then
        raise exception 'La progression ne peut pas être modifiée directement.';
    end if;

    return new;

end;
$$;

drop trigger if exists protect_profile_progress on public.profiles;

create trigger protect_profile_progress
    before update on public.profiles
    for each row
    execute function public.protect_profile_progress();


-- ---------------------------------------------------------
-- 3. Pointage du jour (série de connexions)
--    Hier → la série continue. Plus ancien → elle repart à 1.
-- ---------------------------------------------------------

create or replace function public.daily_checkin(
    out streak integer,
    out increased boolean,
    out chest_available boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_profile record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select streak_days, last_checkin, last_chest into v_profile
    from profiles
    where id = v_user
    for update;

    increased := v_profile.last_checkin is distinct from v_today;

    if increased then

        streak := case
            when v_profile.last_checkin = v_today - 1 then v_profile.streak_days + 1
            else 1
        end;

        perform set_config('betlab.allow_points', 'on', true);

        update profiles
        set streak_days = streak,
            last_checkin = v_today
        where id = v_user;

        perform set_config('betlab.allow_points', 'off', true);

    else

        streak := v_profile.streak_days;

    end if;

    -- L'administrateur peut ouvrir le coffre sans limite.
    chest_available := v_profile.last_chest is distinct from v_today
        or exists (select 1 from profiles where id = v_user and is_admin);

end;
$$;


-- ---------------------------------------------------------
-- 4. Coffre quotidien : des points au hasard, une fois par jour
-- ---------------------------------------------------------

create or replace function public.open_daily_chest()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_last date;
    v_roll numeric := random();
    v_points integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select case when is_admin then null else last_chest end into v_last
    from profiles
    where id = v_user
    for update;

    if v_last = v_today then
        raise exception 'Le coffre du jour est déjà ouvert. Reviens demain !';
    end if;

    v_points := case
        when v_roll < 0.40 then 5
        when v_roll < 0.70 then 10
        when v_roll < 0.90 then 15
        else 20
    end;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set points = points + v_points,
        last_chest = v_today
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

    return v_points;

end;
$$;


-- ---------------------------------------------------------
-- 5. XP du joueur connecté
--    10 XP par mise, 25 XP par pari gagné.
--    Les missions ne donnent pas d'XP.
--    Seules les mises faites après la dernière réinitialisation
--    de l'XP comptent (voir reinitialisation.sql).
-- ---------------------------------------------------------

create table if not exists public.app_settings (
    key text primary key,
    value timestamptz
);

alter table public.app_settings enable row level security;


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
    select (
        (select count(*) * 10
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


-- ---------------------------------------------------------
-- 6. Administrateur : solde et points illimités
--    Après chaque modification de son profil, le solde
--    et les points de l'admin sont remis au plafond.
--    (Le nom « zz_ » fait passer ce trigger après les autres.)
-- ---------------------------------------------------------

create or replace function public.admin_unlimited()
returns trigger
language plpgsql
as $$
begin

    if new.is_admin then
        new.balance := greatest(new.balance, 1000000000);
        new.points := greatest(new.points, 1000000000);
    end if;

    return new;

end;
$$;

drop trigger if exists zz_admin_unlimited on public.profiles;

create trigger zz_admin_unlimited
    before update on public.profiles
    for each row
    execute function public.admin_unlimited();


-- Mise à niveau immédiate des comptes admin existants.
select set_config('betlab.allow_points', 'on', false);

update public.profiles
set balance = greatest(balance, 1000000000),
    points = greatest(points, 1000000000)
where is_admin;

select set_config('betlab.allow_points', 'off', false);


-- ---------------------------------------------------------
-- 7. Droits d'appel
-- ---------------------------------------------------------

grant execute on function public.daily_checkin() to authenticated;
grant execute on function public.open_daily_chest() to authenticated;
grant execute on function public.player_xp() to authenticated;
