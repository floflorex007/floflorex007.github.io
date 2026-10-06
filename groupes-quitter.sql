-- =========================================================
-- BetLab : quitter un groupe
--
-- À lancer après groupes.sql, une seule fois.
--
--   leave_group(groupe, nouveau_créateur)
--     - un membre quitte le groupe : il perd son solde, ses
--       points et sa boutique dans ce groupe ;
--     - le créateur doit désigner un nouveau créateur parmi les
--       membres (hors administrateur) ; celui-ci reçoit aussi les
--       pouvoirs ;
--     - si le créateur est le dernier membre, le groupe est
--       supprimé avec ses paris.
-- =========================================================

create or replace function public.leave_group(p_group uuid, p_new_owner uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_group groups;
    v_others integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select * into v_group
    from groups
    where id = p_group
    for update;

    if v_group.id is null
        or not exists (select 1 from group_members where group_id = p_group and user_id = v_user)
    then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;


    if v_group.created_by is not distinct from v_user then

        -- Membres qui peuvent reprendre le groupe (hors admin et hors moi).
        select count(*) into v_others
        from group_members m
        join profiles p on p.id = m.user_id
        where m.group_id = p_group
          and m.user_id <> v_user
          and not p.is_admin;

        if v_others = 0 then

            -- Personne d'autre : le groupe disparaît.
            delete from groups where id = p_group;

            return 'supprime';

        end if;

        if p_new_owner is null
            or not exists (
                select 1
                from group_members m
                join profiles p on p.id = m.user_id
                where m.group_id = p_group
                  and m.user_id = p_new_owner
                  and m.user_id <> v_user
                  and not p.is_admin
            )
        then
            raise exception 'Choisis qui devient le nouveau créateur du groupe.';
        end if;

        update groups set created_by = p_new_owner where id = p_group;

        update group_members
        set is_manager = true
        where group_id = p_group
          and user_id = p_new_owner;

    end if;


    delete from group_members
    where group_id = p_group
      and user_id = v_user;

    return 'quitte';

end;
$$;

revoke execute on function public.leave_group(uuid, uuid) from public, anon;
grant execute on function public.leave_group(uuid, uuid) to authenticated;
