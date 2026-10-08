-- =========================================================
-- BetLab : l'admin voit tous les comptes, entre dans tous
-- les groupes et peut supprimer un compte
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après
-- suppression-compte.sql, groupes-quitter.sql et
-- demandes-adhesion.sql.
--
--   1. delete_account_data : nettoyage commun à la suppression
--      de son propre compte et à la suppression par l'admin.
--      Un groupe créé par le compte supprimé passe au membre
--      le plus ancien (les ⭐ d'abord), ou disparaît s'il
--      n'y a personne d'autre (comme leave_group).
--   2. delete_my_account : inchangée pour le joueur.
--   3. admin_list_accounts / admin_delete_account : page admin.
--      Le compte admin ne peut jamais être supprimé.
--   4. admin_join_all_groups : l'admin est ajouté (caché) à
--      tous les groupes ; is_group_manager lui donne les
--      pouvoirs partout.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Nettoyage commun (pas appelable depuis le site)
-- ---------------------------------------------------------

create or replace function public.delete_account_data(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_group record;
    v_heir uuid;
begin

    if exists (select 1 from profiles where id = p_user and is_admin) then
        raise exception 'Le compte administrateur ne peut pas être supprimé.';
    end if;

    -- Groupes créés par ce compte : un autre membre les reprend.
    for v_group in
        select id from groups where created_by = p_user
    loop

        select m.user_id into v_heir
        from group_members m
        join profiles p on p.id = m.user_id
        where m.group_id = v_group.id
          and m.user_id <> p_user
          and not p.is_admin
        order by m.is_manager desc, m.joined_at
        limit 1;

        if v_heir is null then

            delete from groups where id = v_group.id;

        else

            update groups set created_by = v_heir where id = v_group.id;

            update group_members
            set is_manager = true
            where group_id = v_group.id
              and user_id = v_heir;

        end if;

    end loop;

    -- Données propres au joueur.
    delete from stakes where user_id = p_user;
    delete from mission_claims where user_id = p_user;
    delete from message_reads where user_id = p_user;

    -- Références vers le joueur : on les détache.
    update bets set author_id = null where author_id = p_user;
    update bets set target_user_id = null, target_blocked = false where target_user_id = p_user;
    update admin_messages set created_by = null where created_by = p_user;

    -- Profil puis compte de connexion.
    delete from profiles where id = p_user;
    delete from auth.users where id = p_user;

end;
$$;

revoke execute on function public.delete_account_data(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------
-- 2. Supprimer son propre compte (page Profil)
-- ---------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    perform public.delete_account_data(auth.uid());

end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------
-- 3. Page admin : tous les comptes, suppression directe
-- ---------------------------------------------------------

drop function if exists public.admin_list_accounts();

create or replace function public.admin_list_accounts()
returns table (
    user_id uuid,
    username text,
    is_admin boolean,
    created_at timestamptz,
    last_sign_in_at timestamptz,
    group_names text
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
    select p.id,
           p.username,
           coalesce(p.is_admin, false),
           coalesce(p.created_at, u.created_at),
           u.last_sign_in_at,
           (select string_agg(g.name, ', ' order by g.name)
            from group_members m
            join groups g on g.id = m.group_id
            where m.user_id = p.id)
    from profiles p
    left join auth.users u on u.id = p.id
    order by coalesce(p.is_admin, false) desc, coalesce(p.created_at, u.created_at) desc;

end;
$$;

create or replace function public.admin_delete_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    if p_user = auth.uid() then
        raise exception 'Le compte administrateur ne peut pas être supprimé.';
    end if;

    if not exists (select 1 from profiles where id = p_user) then
        raise exception 'Ce compte n''existe plus.';
    end if;

    perform public.delete_account_data(p_user);

end;
$$;


-- ---------------------------------------------------------
-- 4. L'admin dans tous les groupes, avec les pouvoirs
-- ---------------------------------------------------------

create or replace function public.admin_join_all_groups()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_added integer;
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    insert into group_members (group_id, user_id)
    select g.id, auth.uid()
    from groups g
    where not exists (
        select 1 from group_members m
        where m.group_id = g.id
          and m.user_id = auth.uid()
    );

    get diagnostics v_added = row_count;

    return v_added;

end;
$$;

-- Gérant d'un groupe : créateur, membre avec les pouvoirs, ou admin.
create or replace function public.is_group_manager(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from group_members m
        join groups g on g.id = m.group_id
        where m.group_id = p_group
          and m.user_id = auth.uid()
          and (m.is_manager or g.created_by = auth.uid())
    )
    or exists (select 1 from profiles where id = auth.uid() and is_admin);
$$;
