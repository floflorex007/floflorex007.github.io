-- =========================================================
-- BetLab : prévenir un joueur retiré d'un groupe
--
-- À lancer après groupes.sql, une seule fois.
--
--   - Table group_removals : une ligne à chaque retrait.
--   - remove_group_member l'alimente.
--   - ack_group_removals : le joueur marque les retraits comme vus
--     (le site affiche une pop-up tant qu'il en reste un non vu).
-- =========================================================

create table if not exists public.group_removals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    group_id uuid not null,
    group_name text not null,
    removed_at timestamptz not null default now(),
    seen_at timestamptz
);

create index if not exists group_removals_user_idx
    on public.group_removals (user_id)
    where seen_at is null;

alter table public.group_removals enable row level security;

drop policy if exists group_removals_select_own on public.group_removals;
create policy group_removals_select_own on public.group_removals
    for select to authenticated
    using (user_id = auth.uid());


create or replace function public.remove_group_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text;
begin

    if not is_group_manager(p_group) then
        raise exception 'Tu n''as pas les pouvoirs dans ce groupe.';
    end if;

    if p_user = auth.uid() then
        raise exception 'Tu ne peux pas te retirer toi-même.';
    end if;

    if exists (select 1 from groups where id = p_group and created_by = p_user) then
        raise exception 'Le créateur du groupe ne peut pas être retiré.';
    end if;

    select name into v_name from groups where id = p_group;

    delete from group_members
    where group_id = p_group
      and user_id = p_user;

    if found then

        insert into group_removals (user_id, group_id, group_name)
        values (p_user, p_group, v_name);

    end if;

end;
$$;


create or replace function public.ack_group_removals()
returns void
language sql
security definer
set search_path = public
as $$
    update group_removals
    set seen_at = now()
    where user_id = auth.uid()
      and seen_at is null;
$$;

revoke execute on function public.ack_group_removals() from public, anon;
grant execute on function public.ack_group_removals() to authenticated;


-- ---------------------------------------------------------
-- Aperçu d'un groupe avant de le rejoindre
-- (nom et nombre de membres, sans rejoindre)
-- ---------------------------------------------------------

create or replace function public.preview_group(p_code text)
returns table(name text, members integer)
language plpgsql
security definer
set search_path = public
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    return query
    select g.name,
           (select count(*)::integer
            from group_members m
            join profiles p on p.id = m.user_id
            where m.group_id = g.id
              and not p.is_admin)
    from groups g
    where g.code = upper(trim(p_code));

    if not found then
        raise exception 'Code inconnu, vérifie auprès de tes amis.';
    end if;

end;
$$;

revoke execute on function public.preview_group(text) from public, anon;
grant execute on function public.preview_group(text) to authenticated;
