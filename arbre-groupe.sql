-- =========================================================
-- BetLab : arbre du groupe (étape 1 : l'arbre, sans les effets)
--
-- Chaque groupe gagne de l'XP en jouant. À 2 000, 16 000 et 65 000 XP,
-- ses membres votent entre 2 cases (majorité des membres actifs).
-- Le choix est définitif : l'autre branche est verrouillée.
--
-- XP du groupe (depuis l'allumage de l'arbre dans ce groupe) :
--   - l'XP des mises des membres sur les paris du groupe (stake_xp)
--   - +25 par mise gagnante
--   - +60 par pari résolu avec au moins 2 parieurs
--   - +100 par pari résolu où tous les membres ont misé
--   Le chat ne rapporte rien. Les mises de l'admin ne comptent pas.
--
-- L'arbre s'allume groupe par groupe (admin_set_tree_enabled),
-- pour tester avant de l'ouvrir à tout le monde.
--
-- Cases : w / t (palier 1), w1 w2 t1 t2 (palier 2),
--         w1a w1b w2a w2b t1a t1b t2a t2b (palier 3).
--
-- À lancer après xp-par-mise.sql et groupes.sql.
-- =========================================================


alter table public.groups
    add column if not exists tree_enabled boolean not null default false,
    add column if not exists tree_started_at timestamptz;


-- Cases choisies (une par palier).
create table if not exists public.group_tree_choices (
    group_id uuid not null references public.groups (id) on delete cascade,
    level integer not null check (level between 1 and 3),
    node text not null,
    chosen_at timestamptz not null default now(),
    primary key (group_id, level)
);

-- Votes du palier en cours (effacés quand une case est adoptée).
create table if not exists public.group_tree_votes (
    group_id uuid not null references public.groups (id) on delete cascade,
    level integer not null check (level between 1 and 3),
    user_id uuid not null references public.profiles (id) on delete cascade,
    node text not null,
    voted_at timestamptz not null default now(),
    primary key (group_id, level, user_id)
);

alter table public.group_tree_choices enable row level security;
alter table public.group_tree_votes enable row level security;

-- Lecture seule pour les membres ; tout s'écrit par les fonctions ci-dessous.
drop policy if exists "Membres lisent les cases" on public.group_tree_choices;
create policy "Membres lisent les cases"
    on public.group_tree_choices for select
    using (public.is_group_member(group_id));

drop policy if exists "Membres lisent les votes" on public.group_tree_votes;
create policy "Membres lisent les votes"
    on public.group_tree_votes for select
    using (public.is_group_member(group_id));


-- Seuils d'XP des paliers 1, 2 et 3.
create or replace function public.tree_threshold(p_level integer)
returns integer
language sql
immutable
as $$
    -- Réglés sur Les Fous du BE (≈ 2 300 XP par jour, combinés compris) : 1 jour, 1 semaine, 1 mois.
    select (array[2000, 16000, 65000])[p_level];
$$;


-- Les 2 cases qui suivent une case ('root' = départ).
create or replace function public.tree_children(p_node text)
returns text[]
language sql
immutable
as $$
    select case
        when p_node = 'root' then array['w', 't']
        when length(p_node) = 1 then array[p_node || '1', p_node || '2']
        when length(p_node) = 2 then array[p_node || 'a', p_node || 'b']
        else array[]::text[]
    end;
$$;


-- Détail de l'XP du groupe.
create or replace function public.group_xp_parts(p_group uuid)
returns table (mises integer, gagnes integer, resolus integer, tous integer)
language sql
stable
security definer
set search_path = public
as $$
    with g as (
        select tree_started_at as at
        from groups
        where id = p_group and tree_started_at is not null
    ),
    nb_members as (
        select count(*) as n
        from group_members gm
        join profiles p on p.id = gm.user_id
        where gm.group_id = p_group
          and not coalesce(p.is_admin, false)
    ),
    s as (
        select st.*, b.status, b.winner_choice_id, b.resolved_at
        from stakes st
        join bets b on b.id = st.bet_id
        join profiles p on p.id = st.user_id
        cross join g
        where b.group_id = p_group
          and st.created_at >= g.at
          and not coalesce(p.is_admin, false)
    ),
    resolved as (
        select bet_id, count(distinct user_id) as bettors
        from s
        cross join g
        where status = 'resolved'
          and coalesce(resolved_at, now()) >= g.at
        group by bet_id
    )
    select
        coalesce((select round(sum(stake_xp(stake))) from s), 0)::integer,
        coalesce((select count(*) * 25
                  from s
                  where status = 'resolved'
                    and winner_choice_id = choice_id), 0)::integer,
        coalesce((select count(*) * 60 from resolved where bettors >= 2), 0)::integer,
        coalesce((select count(*) * 100
                  from resolved, nb_members
                  where bettors >= 2 and bettors >= nb_members.n), 0)::integer;
$$;


create or replace function public.group_xp(p_group uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(mises + gagnes + resolus + tous, 0)
    from public.group_xp_parts(p_group);
$$;


-- Membres qui votent : hors admin, venus sur le site depuis moins de 7 jours
-- (ou arrivés dans le groupe depuis moins de 7 jours).
create or replace function public.group_tree_voters(p_group uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
    select gm.user_id
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = p_group
      and not coalesce(p.is_admin, false)
      and (
          p.last_checkin >= (now() at time zone 'Europe/Paris')::date - 7
          or gm.joined_at >= now() - interval '7 days'
      );
$$;


-- Adopte la case du palier en cours si elle a la majorité.
create or replace function public.group_tree_settle(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_level integer;
    v_current text;
    v_voters integer;
    v_need integer;
    v_winner text;
begin
    if not coalesce((select tree_enabled from groups where id = p_group), false) then
        return;
    end if;

    select count(*) + 1,
           coalesce((array_agg(node order by level desc))[1], 'root')
    into v_level, v_current
    from group_tree_choices
    where group_id = p_group;

    if v_level > 3 or public.group_xp(p_group) < public.tree_threshold(v_level) then
        return;
    end if;

    select count(*) into v_voters from public.group_tree_voters(p_group);

    if v_voters = 0 then
        return;
    end if;

    v_need := v_voters / 2 + 1;

    -- Un vote donné compte, même si le joueur est devenu inactif depuis,
    -- tant qu'il est encore dans le groupe.
    select v.node into v_winner
    from group_tree_votes v
    join group_members gm on gm.group_id = v.group_id and gm.user_id = v.user_id
    where v.group_id = p_group
      and v.level = v_level
      and v.node = any (public.tree_children(v_current))
    group by v.node
    having count(*) >= v_need
    limit 1;

    if v_winner is null then
        return;
    end if;

    insert into group_tree_choices (group_id, level, node)
    values (p_group, v_level, v_winner)
    on conflict do nothing;

    delete from group_tree_votes
    where group_id = p_group and level = v_level;
end;
$$;


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


-- Voter pour une case (on peut changer son vote tant que rien n'est adopté).
create or replace function public.group_tree_vote(p_group uuid, p_node text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_level integer;
    v_current text;
begin
    if not public.is_group_member(p_group) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if coalesce((select is_admin from profiles where id = auth.uid()), false) then
        raise exception 'L''admin ne vote pas : ce sont les membres qui choisissent.';
    end if;

    if not coalesce((select tree_enabled from groups where id = p_group), false) then
        raise exception 'L''arbre n''est pas encore ouvert dans ce groupe.';
    end if;

    select count(*) + 1,
           coalesce((array_agg(node order by level desc))[1], 'root')
    into v_level, v_current
    from group_tree_choices
    where group_id = p_group;

    if v_level > 3 then
        raise exception 'L''arbre est déjà terminé.';
    end if;

    if public.group_xp(p_group) < public.tree_threshold(v_level) then
        raise exception 'Le palier n''est pas encore atteint.';
    end if;

    if not (p_node = any (public.tree_children(v_current))) then
        raise exception 'Cette case n''est pas au vote.';
    end if;

    insert into group_tree_votes (group_id, level, user_id, node)
    values (p_group, v_level, auth.uid(), p_node)
    on conflict (group_id, level, user_id)
    do update set node = excluded.node, voted_at = now();

    return public.group_tree_state(p_group);
end;
$$;


-- Ce que voient tous les joueurs : chemin des groupes où l'arbre est ouvert.
create or replace function public.group_tree_public()
returns table (group_id uuid, name text, path text[], xp integer)
language sql
stable
security definer
set search_path = public
as $$
    select g.id,
           g.name,
           coalesce((
               select array_agg(c.node order by c.level)
               from group_tree_choices c
               where c.group_id = g.id
           ), array[]::text[]),
           public.group_xp(g.id)
    from groups g
    where g.tree_enabled
      and auth.uid() is not null
    order by g.name;
$$;


-- Admin : allumer / éteindre l'arbre d'un groupe.
-- L'XP compte à partir du premier allumage (rien d'avant).
create or replace function public.admin_set_tree_enabled(p_group uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not coalesce((select is_admin from profiles where id = auth.uid()), false) then
        raise exception 'Réservé à l''admin.';
    end if;

    update groups
    set tree_enabled = p_on,
        tree_started_at = coalesce(tree_started_at, case when p_on then now() end)
    where id = p_group;
end;
$$;


revoke all on function public.group_tree_settle(uuid) from public, anon, authenticated;
revoke all on function public.group_xp_parts(uuid) from public, anon;
revoke all on function public.group_xp(uuid) from public, anon;
revoke all on function public.group_tree_voters(uuid) from public, anon, authenticated;

grant execute on function public.group_tree_state(uuid) to authenticated;
grant execute on function public.group_tree_vote(uuid, text) to authenticated;
grant execute on function public.group_tree_public() to authenticated;
grant execute on function public.admin_set_tree_enabled(uuid, boolean) to authenticated;
