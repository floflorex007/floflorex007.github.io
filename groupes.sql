-- =========================================================
-- BetLab : groupes privés
--
-- À lancer une seule fois (SQL Editor « Run and enable RLS »,
-- ou par Claude via le terminal).
--
--   1. Tables groups / group_members, colonne bets.group_id.
--   2. Migration : tous les joueurs et paris actuels vont dans
--      un premier groupe « BetLab Bureau » (solde conservé).
--   3. Visibilité (RLS) : on ne voit que les paris, choix et
--      mises des groupes dont on est membre.
--   4. Solde par groupe : place_bet et claim_bet utilisent
--      group_members.balance (profiles.balance n'est plus utilisé).
--   5. Fonctions : créer / rejoindre un groupe, renommer,
--      changer le code, retirer un membre, donner les pouvoirs.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------

create table if not exists public.groups (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    code text not null unique,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.group_members (
    group_id uuid not null references public.groups(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    balance numeric not null default 1000,
    is_manager boolean not null default false,
    joined_at timestamptz not null default now(),
    primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

alter table public.bets
    add column if not exists group_id uuid references public.groups(id) on delete cascade;

create index if not exists bets_group_idx on public.bets (group_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;


-- ---------------------------------------------------------
-- 2. Fonctions utilitaires
-- ---------------------------------------------------------

create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from group_members
        where group_id = p_group
          and user_id = auth.uid()
    );
$$;

create or replace function public.is_group_manager(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from group_members m
        join groups g on g.id = m.group_id
        where m.group_id = p_group
          and m.user_id = auth.uid()
          and (m.is_manager or g.created_by = auth.uid())
    );
$$;

-- Code de 6 caractères sans lettres ambiguës (pas de O/0, I/1).
create or replace function public.new_group_code()
returns text
language plpgsql
set search_path = public
as $$
declare
    v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_code text;
begin
    loop
        v_code := '';
        for i in 1..6 loop
            v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        exit when not exists (select 1 from groups where code = v_code);
    end loop;
    return v_code;
end;
$$;


-- ---------------------------------------------------------
-- 3. Migration de l'existant : premier groupe
--    (créé par le compte « Florian », tous les joueurs dedans
--     avec leur solde actuel, tous les paris rattachés)
-- ---------------------------------------------------------

do $$
declare
    v_group uuid;
    v_owner uuid := 'f27043d8-44fc-49d4-9b7d-c9c70fe63cd2';
begin

    if not exists (select 1 from groups) then

        insert into groups (name, code, created_by)
        values ('BetLab Bureau', new_group_code(), v_owner)
        returning id into v_group;

        insert into group_members (group_id, user_id, balance, is_manager)
        select v_group, id, coalesce(balance, 1000), id = v_owner
        from profiles;

        update bets set group_id = v_group where group_id is null;

    end if;

end;
$$;

alter table public.bets alter column group_id set not null;


-- ---------------------------------------------------------
-- 4. Visibilité (RLS)
-- ---------------------------------------------------------

drop policy if exists groups_select_member on public.groups;
create policy groups_select_member on public.groups
    for select to authenticated
    using (is_group_member(id));

drop policy if exists group_members_select_member on public.group_members;
create policy group_members_select_member on public.group_members
    for select to authenticated
    using (is_group_member(group_id));

-- Paris : seulement ceux de mes groupes.
drop policy if exists "Authenticated users can view bets" on public.bets;
drop policy if exists bets_select_authenticated on public.bets;
drop policy if exists bets_select_group on public.bets;
create policy bets_select_group on public.bets
    for select to authenticated
    using (is_group_member(group_id));

drop policy if exists bets_insert_own on public.bets;
create policy bets_insert_own on public.bets
    for insert to authenticated
    with check (author_id = auth.uid() and is_group_member(group_id));

-- Choix : ceux des paris de mes groupes.
drop policy if exists "Authenticated users can view bet choices" on public.bet_choices;
drop policy if exists bet_choices_select_authenticated on public.bet_choices;
drop policy if exists bet_choices_select_group on public.bet_choices;
create policy bet_choices_select_group on public.bet_choices
    for select to authenticated
    using (exists (
        select 1 from bets b
        where b.id = bet_choices.bet_id
          and is_group_member(b.group_id)
    ));

-- Mises : celles des paris de mes groupes.
drop policy if exists "Stakes are viewable by authenticated users" on public.stakes;
drop policy if exists stakes_select_group on public.stakes;
create policy stakes_select_group on public.stakes
    for select to authenticated
    using (exists (
        select 1 from bets b
        where b.id = stakes.bet_id
          and is_group_member(b.group_id)
    ));


-- ---------------------------------------------------------
-- 5. Admin : solde illimité dans chacun de ses groupes
-- ---------------------------------------------------------

create or replace function public.admin_unlimited_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    if exists (select 1 from profiles where id = new.user_id and is_admin) then
        new.balance := greatest(new.balance, 1000000000);
    end if;

    return new;

end;
$$;

drop trigger if exists zz_admin_unlimited_member on public.group_members;
create trigger zz_admin_unlimited_member
    before insert or update on public.group_members
    for each row
    execute function public.admin_unlimited_member();


-- ---------------------------------------------------------
-- 6. Miser et récupérer : solde du groupe du pari
-- ---------------------------------------------------------

create or replace function public.place_bet(p_choice_id uuid, p_stake numeric)
returns stakes
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_balance numeric;
    v_bet_id uuid;
    v_group_id uuid;
    v_odds numeric;
    v_potential_win numeric;
    v_stake public.stakes;
begin

    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Utilisateur non connecté';
    end if;


    if p_stake is null or p_stake <= 0 then
        raise exception 'La mise doit être supérieure à 0';
    end if;

    if p_stake <> trunc(p_stake) then
        raise exception 'La mise doit être un montant rond (sans centimes)';
    end if;


    select bc.bet_id, bc.odds, b.group_id
    into v_bet_id, v_odds, v_group_id
    from public.bet_choices bc
    join public.bets b
        on b.id = bc.bet_id
    where bc.id = p_choice_id
      and b.status = 'open';

    if v_bet_id is null then
        raise exception 'Ce pari n''est plus disponible';
    end if;


    select balance
    into v_balance
    from public.group_members
    where group_id = v_group_id
      and user_id = v_user_id
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe';
    end if;

    if v_balance < p_stake then
        raise exception 'Solde insuffisant';
    end if;


    v_potential_win := round(p_stake * v_odds, 2);


    update public.group_members
    set balance = balance - p_stake
    where group_id = v_group_id
      and user_id = v_user_id;


    insert into public.stakes (
        bet_id,
        choice_id,
        user_id,
        stake,
        potential_win
    )
    values (
        v_bet_id,
        p_choice_id,
        v_user_id,
        p_stake,
        v_potential_win
    )
    returning * into v_stake;

    return v_stake;

end;
$$;


create or replace function public.claim_bet(p_bet_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_winner uuid;
    v_status text;
    v_group uuid;
    v_total numeric := 0;
    v_count integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select status, winner_choice_id, group_id into v_status, v_winner, v_group
    from bets
    where id = p_bet_id;

    if v_status is distinct from 'resolved' then
        raise exception 'Ce pari n''est pas encore validé.';
    end if;

    -- Verrouille le solde du groupe pour éviter deux récupérations simultanées.
    perform 1 from group_members
    where group_id = v_group and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais plus partie de ce groupe.';
    end if;

    select count(*), coalesce(sum(case when choice_id = v_winner then potential_win else 0 end), 0)
    into v_count, v_total
    from stakes
    where bet_id = p_bet_id
      and user_id = v_user
      and claimed_at is null;

    if v_count = 0 then
        raise exception 'Rien à récupérer sur ce pari.';
    end if;

    update stakes
    set claimed_at = now()
    where bet_id = p_bet_id
      and user_id = v_user
      and claimed_at is null;

    if v_total > 0 then
        update group_members
        set balance = balance + v_total
        where group_id = v_group
          and user_id = v_user;
    end if;

    return v_total;

end;
$$;


-- ---------------------------------------------------------
-- 7. Gestion des groupes
-- ---------------------------------------------------------

create or replace function public.create_group(p_name text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_name text := trim(p_name);
    v_group groups;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if char_length(v_name) < 3 or char_length(v_name) > 40 then
        raise exception 'Le nom du groupe doit faire entre 3 et 40 caractères.';
    end if;

    insert into groups (name, code, created_by)
    values (v_name, new_group_code(), v_user)
    returning * into v_group;

    insert into group_members (group_id, user_id, is_manager)
    values (v_group.id, v_user, true);

    return v_group;

end;
$$;


create or replace function public.join_group(p_code text)
returns groups
language plpgsql
security definer
set search_path = public
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

    insert into group_members (group_id, user_id)
    values (v_group.id, v_user);

    return v_group;

end;
$$;


create or replace function public.rename_group(p_group uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := trim(p_name);
begin

    if not is_group_manager(p_group) then
        raise exception 'Tu n''as pas les pouvoirs dans ce groupe.';
    end if;

    if char_length(v_name) < 3 or char_length(v_name) > 40 then
        raise exception 'Le nom du groupe doit faire entre 3 et 40 caractères.';
    end if;

    update groups set name = v_name where id = p_group;

end;
$$;


create or replace function public.regenerate_group_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_code text;
begin

    if not is_group_manager(p_group) then
        raise exception 'Tu n''as pas les pouvoirs dans ce groupe.';
    end if;

    v_code := new_group_code();

    update groups set code = v_code where id = p_group;

    return v_code;

end;
$$;


create or replace function public.remove_group_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

    delete from group_members
    where group_id = p_group
      and user_id = p_user;

end;
$$;


create or replace function public.set_group_manager(p_group uuid, p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not is_group_manager(p_group) then
        raise exception 'Tu n''as pas les pouvoirs dans ce groupe.';
    end if;

    if exists (select 1 from groups where id = p_group and created_by = p_user) then
        raise exception 'Le créateur du groupe garde toujours ses pouvoirs.';
    end if;

    update group_members
    set is_manager = p_on
    where group_id = p_group
      and user_id = p_user;

end;
$$;


revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.rename_group(uuid, text) from public, anon;
revoke execute on function public.regenerate_group_code(uuid) from public, anon;
revoke execute on function public.remove_group_member(uuid, uuid) from public, anon;
revoke execute on function public.set_group_manager(uuid, uuid, boolean) from public, anon;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.regenerate_group_code(uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.set_group_manager(uuid, uuid, boolean) to authenticated;
