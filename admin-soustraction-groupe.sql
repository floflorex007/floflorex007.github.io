-- =========================================================
-- BetLab : l'admin retire un montant à tous les joueurs d'un groupe
-- (2026-10-14)
--
-- admin_subtract_group(p_group, p_amount) : chaque membre du groupe
-- (sauf l'admin) perd p_amount € sur son solde du groupe, sans
-- jamais descendre sous 0 €. Chaque joueur touché reçoit un message
-- (player_notices) à sa prochaine visite.
-- Renvoie le nombre de joueurs touchés et le total retiré.
-- =========================================================


create or replace function public.admin_subtract_group(p_group uuid, p_amount numeric)
returns table (players integer, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_group_name text;
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then
        raise exception 'Le montant doit être un nombre entier positif.';
    end if;

    select name into v_group_name from groups where id = p_group;

    if v_group_name is null then
        raise exception 'Groupe introuvable.';
    end if;

    return query
    with touched as (
        select gm.user_id, gm.balance as before, greatest(0, gm.balance - p_amount) as after
        from group_members gm
        join profiles p on p.id = gm.user_id
        where gm.group_id = p_group
          and not p.is_admin
          and gm.balance > 0
        for update of gm
    ),
    updated as (
        update group_members gm
        set balance = t.after
        from touched t
        where gm.group_id = p_group
          and gm.user_id = t.user_id
        returning t.user_id, t.before, t.after
    ),
    told as (
        insert into player_notices (user_id, title, content)
        select u.user_id,
               '💸 Retrait de l''admin',
               'L''admin a retiré ' || public.format_euros(u.before - u.after)
               || ' à tous les joueurs du groupe « ' || v_group_name || ' ».'
               || ' Ton solde passe à ' || public.format_euros(u.after) || '.'
        from updated u
        returning 1
    )
    select count(*)::integer, coalesce(sum(u.before - u.after), 0)
    from updated u;

end;
$$;

revoke all on function public.admin_subtract_group(uuid, numeric) from public, anon;
grant execute on function public.admin_subtract_group(uuid, numeric) to authenticated;
