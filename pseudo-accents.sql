-- =========================================================
-- Pseudos avec accents (2026-10-18)
--
-- Le pseudo garde ses accents à l'affichage (« Hélène »), mais
-- le compte est le même avec ou sans : le faux e-mail est sans
-- accent (helene@betlab.test, voir usernameToEmail dans app.js).
--
-- pseudo_cle() = même transformation que usernameToEmail() :
-- sans espaces, sans accents, en minuscules. Tous les endroits
-- qui comparent des pseudos passent par elle.
-- À lancer après pseudo-disponible.sql, mot-de-passe-oublie.sql,
-- pseudo-48h.sql et identifiant-oublie.sql (elle les remplace).
-- =========================================================

create extension if not exists unaccent with schema extensions;


create or replace function public.pseudo_cle(p_username text)
returns text
language sql
stable
set search_path = public
as $$
    select lower(extensions.unaccent(regexp_replace(coalesce(p_username, ''), '\s', '', 'g')));
$$;


-- Question 1 de l'inscription : « Hélène » est pris si « Helene » existe.

create or replace function public.pseudo_disponible(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not exists (
        select 1
        from profiles
        where pseudo_cle(username) = pseudo_cle(p_username)
    );
$$;

grant execute on function public.pseudo_disponible(text) to anon, authenticated;


-- Identifiant oublié : « E » trouve aussi « Élodie ».

create or replace function public.pseudos_par_lettre(p_lettre text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
    select username
    from profiles
    where length(trim(p_lettre)) = 1
      and left(pseudo_cle(username), 1) = pseudo_cle(p_lettre)
    order by pseudo_cle(username);
$$;

grant execute on function public.pseudos_par_lettre(text) to anon, authenticated;


-- Mot de passe oublié : même conversion que usernameToEmail().

create or replace function public.request_password_reset(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_user uuid;
begin

    select u.id into v_user
    from auth.users u
    where u.email = pseudo_cle(p_username) || '@betlab.test';

    if v_user is null
       or exists (select 1 from profiles where id = v_user and is_admin) then
        return;
    end if;

    insert into password_reset_requests (user_id)
    values (v_user)
    on conflict (user_id) do update
    set created_at = now();

end;
$function$;


-- Changement de pseudo (reste de pseudo-48h.sql inchangé).

create or replace function public.change_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
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

    -- Le faux e-mail doit rester valide pour pouvoir se reconnecter.
    if pseudo_cle(v_name) !~ '^[a-z0-9_-]+(\.[a-z0-9_-]+)*$' then
        raise exception 'Lettres, chiffres, point, tiret ou _ seulement.';
    end if;

    v_email := pseudo_cle(v_name) || '@betlab.test';

    if exists (
        select 1 from profiles
        where pseudo_cle(username) = pseudo_cle(v_name)
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
