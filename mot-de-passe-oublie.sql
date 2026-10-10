-- =========================================================
-- BetLab : mot de passe oublié (demande à l'admin)
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après admin-comptes.sql.
--
-- Les comptes n'ont pas de vrai e-mail (pseudo@betlab.test) :
-- pas d'e-mail de réinitialisation possible. À la place :
--   1. Sur la page de connexion, le joueur tape son identifiant
--      → une demande est envoyée à l'admin.
--   2. L'admin voit les demandes dans la carte « Comptes »,
--      choisit un mot de passe provisoire et le donne au joueur.
-- L'admin peut aussi changer le mot de passe de n'importe quel
-- compte (bouton « Mot de passe » de la liste des comptes).
--   3. Ce mot de passe est provisoire : à la connexion, le joueur
--      doit en choisir un nouveau avant d'entrer sur le site
--      (profiles.must_change_password).
-- =========================================================


-- ---------------------------------------------------------
-- 1. Table des demandes (une seule par compte)
-- ---------------------------------------------------------

create table if not exists public.password_reset_requests (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now()
);

-- Aucune lecture ni écriture directe : tout passe par les fonctions ci-dessous.
alter table public.password_reset_requests enable row level security;


-- Mot de passe provisoire donné par l'admin : à changer à la connexion.
alter table public.profiles
    add column if not exists must_change_password boolean not null default false;


-- ---------------------------------------------------------
-- 2. Envoyer une demande (page de connexion, sans être connecté)
--    Même réponse que le compte existe ou non : on ne révèle
--    pas quels identifiants sont pris.
-- ---------------------------------------------------------

create or replace function public.request_password_reset(p_username text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid;
begin

    -- Même conversion que usernameToEmail() dans app.js.
    select u.id into v_user
    from auth.users u
    where u.email = lower(regexp_replace(coalesce(p_username, ''), '\s', '', 'g')) || '@betlab.test';

    if v_user is null
       or exists (select 1 from profiles where id = v_user and is_admin) then
        return;
    end if;

    insert into password_reset_requests (user_id)
    values (v_user)
    on conflict (user_id) do update
    set created_at = now();

end;
$$;

revoke execute on function public.request_password_reset(text) from public;
grant execute on function public.request_password_reset(text) to anon, authenticated;


-- ---------------------------------------------------------
-- 3. Admin : demandes en attente
-- ---------------------------------------------------------

create or replace function public.admin_list_password_resets()
returns table (
    user_id uuid,
    username text,
    created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin

    if not exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    return query
    select r.user_id, p.username, r.created_at
    from password_reset_requests r
    join profiles p on p.id = r.user_id
    order by r.created_at;

end;
$$;

revoke execute on function public.admin_list_password_resets() from public, anon;
grant execute on function public.admin_list_password_resets() to authenticated;


-- ---------------------------------------------------------
-- 4. Admin : choisir un nouveau mot de passe
--    (la demande éventuelle est effacée)
-- ---------------------------------------------------------

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    if length(coalesce(p_password, '')) < 4 then
        raise exception 'Le mot de passe doit contenir au moins 4 caractères.';
    end if;

    update auth.users
    set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = p_user;

    if not found then
        raise exception 'Ce compte n''existe plus.';
    end if;

    -- Mot de passe provisoire : le joueur le change à sa connexion
    -- (sauf l'admin qui change le sien).
    update profiles
    set must_change_password = (p_user <> auth.uid())
    where id = p_user;

    delete from password_reset_requests where user_id = p_user;

end;
$$;

revoke execute on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;


-- ---------------------------------------------------------
-- 5. Admin : ignorer une demande
-- ---------------------------------------------------------

create or replace function public.admin_dismiss_password_reset(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    delete from password_reset_requests where user_id = p_user;

end;
$$;

revoke execute on function public.admin_dismiss_password_reset(uuid) from public, anon;
grant execute on function public.admin_dismiss_password_reset(uuid) to authenticated;


-- ---------------------------------------------------------
-- 6. Le joueur a choisi son nouveau mot de passe
--    (appelé par le site juste après auth.updateUser)
-- ---------------------------------------------------------

create or replace function public.finish_password_change()
returns void
language sql
security definer
set search_path to 'public'
as $$
    update profiles
    set must_change_password = false
    where id = auth.uid();
$$;

revoke execute on function public.finish_password_change() from public, anon;
grant execute on function public.finish_password_change() to authenticated;
