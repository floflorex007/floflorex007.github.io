-- =========================================================
-- BetLab : arbre du groupe, vote directement dans l'arbre
--
-- group_tree_state donne aussi, pour chaque membre, la case
-- pour laquelle il a voté (champ « vote ») : l'arbre affiche
-- les pastilles des votants sur les 2 cases au vote.
--
-- Remplace group_tree_state (arbre-groupe.sql). À lancer après lui.
-- =========================================================


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
