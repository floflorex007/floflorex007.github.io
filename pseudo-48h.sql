-- =========================================================
-- BetLab : un seul changement de pseudo toutes les 48 h (2026-10-14)
--
-- profiles.username_changed_at : date du dernier changement
-- (posée par change_username). Les joueurs ne peuvent pas la
-- modifier eux-mêmes (aucune policy UPDATE sur profiles).
-- L'admin n'est pas limité. Le reste de change_username est
-- inchangé (profil.sql).
-- =========================================================


alter table public.profiles
    add column if not exists username_changed_at timestamptz;


CREATE OR REPLACE FUNCTION public.change_username(p_username text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare

    v_user uuid := auth.uid();

    v_name text := trim(p_username);

    v_email text;
    v_last timestamptz;

begin



    if v_user is null then

        raise exception 'Utilisateur non connecté.';

    end if;



    -- Un seul changement toutes les 48 h (l'admin n'est pas limité).
    select username_changed_at into v_last from profiles where id = v_user;

    if v_last is not null
        and v_last > now() - interval '48 hours'
        and not exists (select 1 from profiles where id = v_user and is_admin)
    then
        raise exception 'Tu as déjà changé de pseudo il y a moins de 48 h. Prochain changement possible le %.',
            to_char((v_last + interval '48 hours') at time zone 'Europe/Paris', 'DD/MM à HH24"h"MI');
    end if;

    if char_length(v_name) < 3 then

        raise exception 'Le pseudo doit contenir au moins 3 caractères.';

    end if;



    if char_length(v_name) > 20 then

        raise exception 'Le pseudo doit contenir au maximum 20 caractères.';

    end if;



    -- Même transformation que usernameToEmail() côté site.

    v_email := lower(regexp_replace(v_name, '\s+', '', 'g')) || '@betlab.test';



    if exists (

        select 1 from profiles

        where lower(username) = lower(v_name)

          and id <> v_user

    ) or exists (

        select 1 from auth.users

        where lower(email) = v_email

          and id <> v_user

    ) then

        raise exception 'Ce pseudo est déjà utilisé.';

    end if;



    update profiles

    set username = v_name,
        username_changed_at = now()

    where id = v_user;



    update auth.users

    set email = v_email,

        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)

            || jsonb_build_object('username', v_name)

    where id = v_user;



    update auth.identities

    set identity_data = identity_data || jsonb_build_object('email', v_email)

    where user_id = v_user

      and provider = 'email';



    return v_name;



end;

$function$;
