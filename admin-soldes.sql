-- =========================================================
-- BetLab : l'administrateur peut modifier le solde de n'importe qui
--
-- admin_list_balances() : tous les soldes, de tous les groupes.
-- admin_set_balance(p_group, p_user, p_balance) : fixe un solde.
-- Les deux refusent tout compte qui n'est pas administrateur.
--
-- À lancer après groupes.sql.
-- =========================================================

create or replace function public.admin_list_balances()
returns table(group_id uuid, group_name text, user_id uuid, username text, balance numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    return query
        select g.id, g.name, p.id, p.username, gm.balance
        from group_members gm
        join groups g on g.id = gm.group_id
        join profiles p on p.id = gm.user_id
        where not p.is_admin
        order by g.name, p.username;

end;
$$;


create or replace function public.admin_set_balance(p_group uuid, p_user uuid, p_balance numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_balance numeric;
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    if p_balance is null or p_balance < 0 then
        raise exception 'Le solde doit être un montant positif.';
    end if;

    update group_members
    set balance = round(p_balance)
    where group_id = p_group
      and user_id = p_user
    returning balance into v_balance;

    if not found then
        raise exception 'Ce joueur ne fait pas partie de ce groupe.';
    end if;

    return v_balance;

end;
$$;
