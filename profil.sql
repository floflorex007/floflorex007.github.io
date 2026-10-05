-- =========================================================
--   BETLAB : CHANGEMENT DE PSEUDO (onglet Profil)
--   À coller dans Supabase → SQL Editor → Run.
--   Le script peut être relancé sans risque.
--
--   Le pseudo sert aussi d'identifiant de connexion
--   (pseudo → pseudo@betlab.test, voir usernameToEmail dans app.js).
--   On met donc à jour le profil ET l'email du compte Supabase Auth :
--   après le changement, on se connecte avec le nouveau pseudo.
-- =========================================================

create or replace function public.change_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_name text := trim(p_username);
    v_email text;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
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
    set username = v_name
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
$$;

revoke execute on function public.change_username(text) from public, anon;
grant execute on function public.change_username(text) to authenticated;
