-- =========================================================
-- BetLab : rejoindre un groupe sur demande (validation)
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après groupes.sql.
--
-- Pour limiter les faux comptes : le code d'un groupe n'y fait
-- plus entrer directement, il envoie une demande. Le créateur du
-- groupe, ceux qui ont les pouvoirs et l'admin l'acceptent (le
-- joueur entre avec le solde de départ) ou la refusent.
-- Créer son propre groupe ne demande aucune validation.
-- Les membres déjà présents ne sont pas touchés.
-- Côté site : section « DEMANDES D'ADHÉSION » dans app.js
-- (maquette demo-validation-membres.html, proposition A).
-- =========================================================


-- ---------------------------------------------------------
-- 1. Table des demandes
-- ---------------------------------------------------------

create table if not exists public.group_join_requests (
    group_id uuid not null references public.groups (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'refused')),
    created_at timestamptz not null default now(),
    answered_at timestamptz,
    primary key (group_id, user_id)
);

-- Aucune lecture ni écriture directe : tout passe par les fonctions ci-dessous.
alter table public.group_join_requests enable row level security;


-- ---------------------------------------------------------
-- 2. Peut valider les demandes : gérant du groupe ou admin
-- ---------------------------------------------------------

create or replace function public.can_answer_join_requests(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select public.is_group_manager(p_group)
        or exists (select 1 from profiles where id = auth.uid() and is_admin);
$$;


-- ---------------------------------------------------------
-- 3. join_group : envoie une demande au lieu d'entrer
-- ---------------------------------------------------------

create or replace function public.join_group(p_code text)
returns groups
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_group groups;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select * into v_group
    from groups
    where code = upper(trim(p_code));

    if v_group.id is null then
        raise exception 'Code inconnu, vérifie auprès de tes amis.';
    end if;

    if exists (select 1 from group_members where group_id = v_group.id and user_id = v_user) then
        raise exception 'Tu fais déjà partie de ce groupe.';
    end if;

    -- Une demande refusée peut être refaite : elle repasse en attente.
    insert into group_join_requests (group_id, user_id)
    values (v_group.id, v_user)
    on conflict (group_id, user_id) do update
    set status = 'pending',
        created_at = now(),
        answered_at = null;

    return v_group;

end;
$$;


-- ---------------------------------------------------------
-- 4. Mes demandes (écran d'attente du nouveau joueur)
-- ---------------------------------------------------------

create or replace function public.my_join_requests()
returns table (
    group_id uuid,
    group_name text,
    members integer,
    status text,
    created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
    select r.group_id,
           g.name,
           (select count(*)::integer
            from group_members m
            join profiles p on p.id = m.user_id
            where m.group_id = g.id
              and not p.is_admin),
           r.status,
           r.created_at
    from group_join_requests r
    join groups g on g.id = r.group_id
    where r.user_id = auth.uid()
    order by r.created_at desc;
$$;


-- Annuler sa demande (ou effacer une demande refusée).
create or replace function public.cancel_join_request(p_group uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
    delete from group_join_requests
    where group_id = p_group
      and user_id = auth.uid();
$$;


-- ---------------------------------------------------------
-- 5. Demandes en attente d'un groupe (fenêtre du groupe)
-- ---------------------------------------------------------

create or replace function public.group_join_requests_for(p_group uuid)
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

    -- Les simples membres ne voient rien (liste vide, pas d'erreur).
    if not public.can_answer_join_requests(p_group) then
        return;
    end if;

    return query
    select r.user_id, p.username, r.created_at
    from group_join_requests r
    join profiles p on p.id = r.user_id
    where r.group_id = p_group
      and r.status = 'pending'
    order by r.created_at;

end;
$$;


-- ---------------------------------------------------------
-- 6. Accepter ou refuser une demande
-- ---------------------------------------------------------

create or replace function public.answer_join_request(p_group uuid, p_user uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if not public.can_answer_join_requests(p_group) then
        raise exception 'Tu n''as pas les pouvoirs dans ce groupe.';
    end if;

    perform 1
    from group_join_requests
    where group_id = p_group
      and user_id = p_user
      and status = 'pending'
    for update;

    if not found then
        raise exception 'Cette demande n''existe plus (déjà traitée ou annulée).';
    end if;

    if p_accept then

        -- Entrée dans le groupe avec le solde de départ (valeur par défaut).
        insert into group_members (group_id, user_id)
        values (p_group, p_user)
        on conflict (group_id, user_id) do nothing;

        delete from group_join_requests
        where group_id = p_group
          and user_id = p_user;

    else

        update group_join_requests
        set status = 'refused',
            answered_at = now()
        where group_id = p_group
          and user_id = p_user;

    end if;

end;
$$;
