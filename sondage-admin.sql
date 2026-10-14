-- =========================================================
-- BetLab : sondage Oui / Non de l'admin (2026-10-14)
--
-- Lancé depuis la carte « Message permanent » de la page admin,
-- affiché sous le message permanent (page des paris), dans le groupe
-- choisi par l'admin (ou dans tous : group_id null). Un seul sondage
-- à la fois par groupe : en lancer un nouveau termine le précédent.
-- Chaque joueur vote une fois (Oui ou Non), comme pour une
-- contestation ; on voit la barre des résultats. Votes anonymes :
-- seul l'admin voit qui a voté (personne ne voit ce que chacun a voté).
-- =========================================================


create table if not exists public.admin_polls (
    id bigint generated always as identity primary key,
    question text not null check (char_length(question) between 3 and 200),
    created_at timestamptz not null default now(),
    closed_at timestamptz
);

-- Groupe où le sondage s'affiche (null = tous les groupes).
alter table public.admin_polls
    add column if not exists group_id uuid references public.groups(id) on delete cascade;

create table if not exists public.admin_poll_votes (
    poll_id bigint not null references public.admin_polls(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    vote_yes boolean not null,
    created_at timestamptz not null default now(),
    primary key (poll_id, user_id)
);

alter table public.admin_polls enable row level security;
alter table public.admin_poll_votes enable row level security;

drop policy if exists "admin_polls lecture" on public.admin_polls;
create policy "admin_polls lecture" on public.admin_polls
    for select using (auth.uid() is not null);

-- Votes : lus seulement par les fonctions ci-dessous (résultats agrégés).


drop function if exists public.admin_start_poll(text);
drop function if exists public.admin_close_poll();
drop function if exists public.admin_delete_poll();
drop function if exists public.current_poll();


create or replace function public.admin_start_poll(p_question text, p_group uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_question text := btrim(coalesce(p_question, ''));
    v_id bigint;
begin
    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    if char_length(v_question) < 3 or char_length(v_question) > 200 then
        raise exception 'La question doit faire entre 3 et 200 caractères.';
    end if;

    -- Le sondage en cours au même endroit (ce groupe, ou « tous ») se termine.
    update admin_polls
    set closed_at = now()
    where closed_at is null
      and group_id is not distinct from p_group;

    insert into admin_polls (question, group_id) values (v_question, p_group) returning id into v_id;

    return v_id;
end;
$$;


create or replace function public.admin_close_poll(p_poll bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    update admin_polls set closed_at = now() where id = p_poll and closed_at is null;
end;
$$;


-- Effacer un sondage (il disparaît de la page des paris).
create or replace function public.admin_delete_poll(p_poll bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    delete from admin_polls where id = p_poll;
end;
$$;


create or replace function public.vote_poll(p_poll bigint, p_yes boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_group uuid;
begin
    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select group_id into v_group from admin_polls where id = p_poll and closed_at is null;

    if not found then
        raise exception 'Ce sondage est terminé.';
    end if;

    if v_group is not null and not is_group_member(v_group) then
        raise exception 'Ce sondage est réservé à un autre groupe.';
    end if;

    insert into admin_poll_votes (poll_id, user_id, vote_yes)
    values (p_poll, auth.uid(), p_yes)
    on conflict (poll_id, user_id) do nothing;

    if not found then
        raise exception 'Tu as déjà voté.';
    end if;
end;
$$;


-- Dernier sondage visible dans ce groupe (le sien ou un sondage « tous les groupes »),
-- avec ses résultats, mon vote et les pseudos des votants.
create or replace function public.current_poll(p_group uuid)
returns table (
    id bigint,
    question text,
    group_id uuid,
    created_at timestamptz,
    closed_at timestamptz,
    votes_yes integer,
    votes_no integer,
    my_vote boolean,
    voters text[]
)
language sql
stable
security definer
set search_path = public
as $$
    select
        p.id,
        p.question,
        p.group_id,
        p.created_at,
        p.closed_at,
        (select count(*) from admin_poll_votes v where v.poll_id = p.id and v.vote_yes)::integer,
        (select count(*) from admin_poll_votes v where v.poll_id = p.id and not v.vote_yes)::integer,
        (select v.vote_yes from admin_poll_votes v where v.poll_id = p.id and v.user_id = auth.uid()),
        -- Votes anonymes : seul l'admin voit qui a voté (jamais ce que chacun a voté).
        case when exists (select 1 from profiles where id = auth.uid() and is_admin)
             then coalesce((select array_agg(pr.username order by v.created_at)
                            from admin_poll_votes v join profiles pr on pr.id = v.user_id
                            where v.poll_id = p.id), '{}')
             else '{}'::text[] end
    from admin_polls p
    where auth.uid() is not null
      and (p.group_id is null or p.group_id = p_group)
      and (is_group_member(p_group) or exists (select 1 from profiles where id = auth.uid() and is_admin))
    order by p.created_at desc
    limit 1;
$$;


revoke all on function public.admin_start_poll(text, uuid) from public, anon;
revoke all on function public.admin_close_poll(bigint) from public, anon;
revoke all on function public.admin_delete_poll(bigint) from public, anon;
revoke all on function public.vote_poll(bigint, boolean) from public, anon;
revoke all on function public.current_poll(uuid) from public, anon;
grant execute on function public.admin_start_poll(text, uuid) to authenticated;
grant execute on function public.admin_close_poll(bigint) to authenticated;
grant execute on function public.admin_delete_poll(bigint) to authenticated;
grant execute on function public.vote_poll(bigint, boolean) to authenticated;
grant execute on function public.current_poll(uuid) to authenticated;
