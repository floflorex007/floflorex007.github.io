-- =========================================================
-- BetLab : dons entre joueurs (version C de demo-dons.html)
--
-- - Un joueur envoie de l'argent de son solde du groupe à un
--   autre membre du même groupe, avec un petit mot facultatif.
-- - 10 € minimum, jamais plus que son solde, pas à soi-même.
-- - L'admin (solde illimité) ne peut ni donner ni recevoir.
-- - Celui qui reçoit voit une fenêtre « Tu as reçu un don »
--   à sa prochaine visite (gifts.seen_at).
--
-- À lancer après groupes.sql.
-- =========================================================


create table if not exists public.gifts (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    from_user uuid not null references public.profiles(id) on delete cascade,
    to_user uuid not null references public.profiles(id) on delete cascade,
    amount numeric not null check (amount >= 10),
    message text check (char_length(message) <= 80),
    created_at timestamptz not null default now(),
    seen_at timestamptz
);

create index if not exists gifts_to_user_unseen on public.gifts (to_user) where seen_at is null;

alter table public.gifts enable row level security;

drop policy if exists "gifts lecture" on public.gifts;

create policy "gifts lecture"
    on public.gifts
    for select
    using (from_user = auth.uid() or to_user = auth.uid());


create or replace function public.give_money(p_group uuid, p_to uuid, p_amount numeric, p_message text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_balance numeric;
    v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_to = v_user then
        raise exception 'Tu ne peux pas te faire un don à toi-même.';
    end if;

    if p_amount is null or p_amount <> trunc(p_amount) or p_amount < 10 then
        raise exception 'Le don doit être d''au moins 10 €, sans centimes.';
    end if;

    if v_message is not null and char_length(v_message) > 80 then
        raise exception 'Le petit mot fait 80 caractères maximum.';
    end if;

    if exists (select 1 from profiles where id in (v_user, p_to) and is_admin) then
        raise exception 'Les dons ne sont pas possibles avec le compte admin.';
    end if;

    -- Solde du donneur, verrouillé le temps du don.
    select balance into v_balance
    from group_members
    where group_id = p_group and user_id = v_user
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = p_to) then
        raise exception 'Ce joueur ne fait pas partie du groupe.';
    end if;

    if p_amount > v_balance then
        raise exception 'Solde insuffisant : tu as % €.', round(v_balance);
    end if;

    update group_members
    set balance = balance - p_amount
    where group_id = p_group and user_id = v_user;

    update group_members
    set balance = balance + p_amount
    where group_id = p_group and user_id = p_to;

    insert into gifts (group_id, from_user, to_user, amount, message)
    values (p_group, v_user, p_to, p_amount, v_message);

    return v_balance - p_amount;

end;
$$;


-- Dons reçus pas encore vus, avec le pseudo du donneur et le nom du groupe.
create or replace function public.unseen_gifts()
returns table (id uuid, amount numeric, message text, from_name text, group_id uuid, group_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
    select g.id, g.amount, g.message, p.username, g.group_id, gr.name, g.created_at
    from gifts g
    join profiles p on p.id = g.from_user
    join groups gr on gr.id = g.group_id
    where g.to_user = auth.uid()
      and g.seen_at is null
    order by g.created_at;
$$;


create or replace function public.mark_gift_seen(p_gift uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    update gifts
    set seen_at = now()
    where id = p_gift
      and to_user = auth.uid()
      and seen_at is null;

end;
$$;


grant execute on function public.give_money(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.unseen_gifts() to authenticated;
grant execute on function public.mark_gift_seen(uuid) to authenticated;
