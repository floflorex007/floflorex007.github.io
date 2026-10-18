-- =========================================================
-- BetLab : arbre du groupe, cœurs sur les cases
--
-- Chaque membre peut mettre un cœur sur les cases à venir de
-- l'arbre (« j'aimerais bien débloquer ça »). Ce n'est pas un
-- vote : autant de cœurs qu'on veut, visibles par le groupe.
--
-- group_tree_state donne aussi « likes » : pour chaque case,
-- les pseudos qui l'aiment.
--
-- À lancer après arbre-vote-pastilles.sql.
-- =========================================================

create table if not exists public.group_tree_likes (
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    node text not null,
    created_at timestamptz not null default now(),
    primary key (group_id, user_id, node)
);

-- Lecture et écriture seulement par les fonctions ci-dessous.
alter table public.group_tree_likes enable row level security;


-- Met ou retire un cœur sur une case à venir ; renvoie l'état de l'arbre.
create or replace function public.group_tree_like(p_group uuid, p_node text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_group_member(p_group) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if not coalesce((select tree_enabled from groups where id = p_group), false) then
        raise exception 'L''arbre n''est pas encore ouvert dans ce groupe.';
    end if;

    if p_node not in ('w', 't', 'w1', 'w2', 't1', 't2',
                      'w1a', 'w1b', 'w2a', 'w2b', 't1a', 't1b', 't2a', 't2b') then
        raise exception 'Case inconnue.';
    end if;

    -- Case déjà débloquée, ou dans une branche écartée : pas de cœur.
    if exists (
        select 1 from group_tree_choices c
        where c.group_id = p_group
          and length(c.node) <= length(p_node)
          and (c.node = p_node or left(p_node, length(c.node)) <> c.node)
    ) then
        raise exception 'Cette case n''est plus à venir.';
    end if;

    if exists (
        select 1 from group_tree_likes
        where group_id = p_group and user_id = auth.uid() and node = p_node
    ) then
        delete from group_tree_likes
        where group_id = p_group and user_id = auth.uid() and node = p_node;
    else
        insert into group_tree_likes (group_id, user_id, node)
        values (p_group, auth.uid(), p_node);
    end if;

    return public.group_tree_state(p_group);
end;
$$;

grant execute on function public.group_tree_like(uuid, text) to authenticated;


-- État complet de l'arbre pour la page « Arbre du groupe ».
create or replace function public.group_tree_state(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_admin boolean := coalesce((select is_admin from profiles where id = auth.uid()), false);
    v_group groups%rowtype;
    v_path text[];
    v_level integer;
    v_parts record;
    v_xp integer;
    v_voting boolean;
    v_need integer;
begin
    if not (v_admin or public.is_group_member(p_group)) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    perform public.group_tree_settle(p_group);

    select * into v_group from groups where id = p_group;

    select coalesce(array_agg(node order by level), array[]::text[])
    into v_path
    from group_tree_choices
    where group_id = p_group;

    v_level := coalesce(array_length(v_path, 1), 0) + 1;

    select * into v_parts from public.group_xp_parts(p_group);

    v_xp := v_parts.mises + v_parts.gagnes + v_parts.resolus + v_parts.tous;

    v_voting := v_group.tree_enabled and v_level <= 3 and v_xp >= public.tree_threshold(v_level);

    select count(*) / 2 + 1 into v_need from public.group_tree_voters(p_group);

    return jsonb_build_object(
        'enabled', v_group.tree_enabled,
        'started_at', v_group.tree_started_at,
        'xp', v_xp,
        'parts', jsonb_build_object(
            'mises', v_parts.mises,
            'gagnes', v_parts.gagnes,
            'resolus', v_parts.resolus,
            'tous', v_parts.tous
        ),
        'path', to_jsonb(v_path),
        'voting', v_voting,
        'need', v_need,
        'my_vote', (
            select node from group_tree_votes
            where group_id = p_group and level = v_level and user_id = auth.uid()
        ),
        'votes', coalesce((
            select jsonb_object_agg(node, n)
            from (
                select v.node, count(*) as n
                from group_tree_votes v
                join group_members gm on gm.group_id = v.group_id and gm.user_id = v.user_id
                where v.group_id = p_group and v.level = v_level
                group by v.node
            ) counts
        ), '{}'::jsonb),
        'likes', coalesce((
            select jsonb_object_agg(node, names)
            from (
                select l.node, jsonb_agg(p.username order by l.created_at) as names
                from group_tree_likes l
                join group_members gm on gm.group_id = l.group_id and gm.user_id = l.user_id
                join profiles p on p.id = l.user_id
                where l.group_id = p_group
                group by l.node
            ) hearts
        ), '{}'::jsonb),
        'members', coalesce((
            select jsonb_agg(jsonb_build_object(
                'username', p.username,
                'active', exists (
                    select 1 from public.group_tree_voters(p_group) t where t.user_id = gm.user_id
                ),
                'voted', exists (
                    select 1 from group_tree_votes v
                    where v.group_id = p_group and v.level = v_level and v.user_id = gm.user_id
                ),
                'vote', (
                    select v.node from group_tree_votes v
                    where v.group_id = p_group and v.level = v_level and v.user_id = gm.user_id
                )
            ) order by p.username)
            from group_members gm
            join profiles p on p.id = gm.user_id
            where gm.group_id = p_group
              and not coalesce(p.is_admin, false)
        ), '[]'::jsonb)
    );
end;
$$;
