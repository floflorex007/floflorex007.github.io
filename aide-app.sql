-- =========================================================
-- BetLab : onglet « Aide app » (bêta-testeurs)
--
-- - Accès sur demande : le joueur demande depuis son Profil,
--   l'admin accepte ou refuse dans l'onglet Aide app.
-- - Bugs (envoyé → corrigé) et idées (envoyée → retenue / pas retenue),
--   avec des « j'aime » sur les idées.
-- - Journal des nouveautés de la semaine (fonctionnalités et design),
--   affiché sur la page Paris, et vote du vendredi.
-- - Points 🪙 crédités dans le groupe où l'action a été faite :
--   envoi 10, bug corrigé +50, idée retenue +150, vote 5, nouveauté élue +100.
-- - Contributions (bugs + idées envoyés) : 5 = pseudo Terminal, 10 = pseudo Glitch.
-- - Boutique : 4 nouveaux pseudos animés.
--
-- À lancer après clic-perroquet.sql.
-- =========================================================


-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------

create table if not exists public.beta_testers (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
    requested_at timestamptz not null default now(),
    decided_at timestamptz,
    -- Le joueur a vu la réponse de l'admin (notification).
    seen_at timestamptz,
    contributions integer not null default 0
);

create table if not exists public.beta_bugs (
    id bigserial primary key,
    user_id uuid not null references public.profiles(id) on delete cascade,
    group_id uuid references public.groups(id) on delete set null,
    topic text not null,
    text text not null check (char_length(text) between 5 and 600),
    status text not null default 'sent' check (status in ('sent', 'fixed', 'rejected')),
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    seen_at timestamptz
);

-- Bugs : l'admin peut aussi les rejeter (pas un bug, déjà signalé…).
alter table public.beta_bugs drop constraint if exists beta_bugs_status_check;
alter table public.beta_bugs add constraint beta_bugs_status_check
    check (status in ('sent', 'fixed', 'rejected'));

create table if not exists public.beta_ideas (
    id bigserial primary key,
    user_id uuid not null references public.profiles(id) on delete cascade,
    group_id uuid references public.groups(id) on delete set null,
    kind text not null check (kind in ('feature', 'design')),
    text text not null check (char_length(text) between 5 and 300),
    status text not null default 'sent' check (status in ('sent', 'kept', 'rejected')),
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    seen_at timestamptz
);

create table if not exists public.beta_idea_likes (
    idea_id bigint not null references public.beta_ideas(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    primary key (idea_id, user_id)
);

-- Nouveautés publiées par l'admin (jamais les bugs corrigés).
create table if not exists public.beta_news (
    id bigserial primary key,
    title text not null check (char_length(title) between 2 and 80),
    kind text not null check (kind in ('feature', 'design')),
    -- Idée d'origine (gain si elle est élue le vendredi).
    idea_id bigint references public.beta_ideas(id) on delete set null,
    -- Auteur de l'idée, recopié ici : le crédit « #pseudo » est visible par tous
    -- (les idées elles-mêmes ne le sont que des bêta-testeurs).
    author_id uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.beta_news
    add column if not exists author_id uuid references public.profiles(id) on delete set null;

-- Vote du vendredi : un vote par joueur et par semaine (lundi de la semaine).
create table if not exists public.beta_votes (
    week_start date not null,
    user_id uuid not null references public.profiles(id) on delete cascade,
    news_id bigint not null references public.beta_news(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (week_start, user_id)
);

-- Semaines dont le vote a été dépouillé (la nouveauté élue a été payée).
create table if not exists public.beta_vote_results (
    week_start date primary key,
    news_id bigint references public.beta_news(id) on delete set null,
    settled_at timestamptz not null default now()
);


-- ---------------------------------------------------------
-- Lecture (toutes les écritures passent par les fonctions plus bas)
-- ---------------------------------------------------------

alter table public.beta_testers enable row level security;
alter table public.beta_bugs enable row level security;
alter table public.beta_ideas enable row level security;
alter table public.beta_idea_likes enable row level security;
alter table public.beta_news enable row level security;
alter table public.beta_votes enable row level security;
alter table public.beta_vote_results enable row level security;


create or replace function public.beta_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

create or replace function public.beta_has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.beta_is_admin()
        or exists (select 1 from beta_testers where user_id = auth.uid() and status = 'accepted');
$$;


-- Statut et contributions : lisibles par tous (les pseudos bêta s'affichent partout).
drop policy if exists "beta_testers lecture" on public.beta_testers;
create policy "beta_testers lecture" on public.beta_testers
    for select to authenticated using (true);

-- Bugs : chacun voit les siens, l'admin voit tout.
drop policy if exists "beta_bugs lecture" on public.beta_bugs;
create policy "beta_bugs lecture" on public.beta_bugs
    for select to authenticated using (user_id = auth.uid() or public.beta_is_admin());

-- Idées et « j'aime » : visibles par les bêta-testeurs et l'admin.
drop policy if exists "beta_ideas lecture" on public.beta_ideas;
create policy "beta_ideas lecture" on public.beta_ideas
    for select to authenticated using (public.beta_has_access() or user_id = auth.uid());

drop policy if exists "beta_idea_likes lecture" on public.beta_idea_likes;
create policy "beta_idea_likes lecture" on public.beta_idea_likes
    for select to authenticated using (public.beta_has_access());

-- Journal et votes : visibles par tous.
drop policy if exists "beta_news lecture" on public.beta_news;
create policy "beta_news lecture" on public.beta_news
    for select to authenticated using (true);

drop policy if exists "beta_votes lecture" on public.beta_votes;
create policy "beta_votes lecture" on public.beta_votes
    for select to authenticated using (true);

drop policy if exists "beta_vote_results lecture" on public.beta_vote_results;
create policy "beta_vote_results lecture" on public.beta_vote_results
    for select to authenticated using (true);


-- ---------------------------------------------------------
-- Outils
-- ---------------------------------------------------------

-- Lundi de la semaine en cours (heure de Paris).
create or replace function public.beta_week_start()
returns date
language sql
stable
as $$
    select date_trunc('week', now() at time zone 'Europe/Paris')::date;
$$;

-- Crédite des points dans un groupe (sans effet si le joueur l'a quitté).
create or replace function public.beta_credit(p_user uuid, p_group uuid, p_points integer)
returns void
language sql
security definer
set search_path = public
as $$
    update group_members
    set points = points + p_points
    where group_id = p_group
      and user_id = p_user;
$$;

revoke all on function public.beta_credit(uuid, uuid, integer) from public, anon, authenticated;


-- Envois récompensés : 5 par jour au maximum (bugs + idées), contre le remplissage.
create or replace function public.beta_check_sender(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if not exists (select 1 from beta_testers where user_id = v_user and status = 'accepted') then
        raise exception 'Réservé aux bêta-testeurs.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select
        (select count(*) from beta_bugs where user_id = v_user and created_at > now() - interval '1 day')
        + (select count(*) from beta_ideas where user_id = v_user and created_at > now() - interval '1 day')
    into v_today;

    if v_today >= 5 then
        raise exception 'Tu as déjà fait 5 envois aujourd''hui : reviens demain !';
    end if;

end;
$$;

revoke all on function public.beta_check_sender(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------
-- Accès bêta
-- ---------------------------------------------------------

create or replace function public.beta_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if exists (select 1 from beta_testers where user_id = v_user and status in ('pending', 'accepted')) then
        raise exception 'Ta demande est déjà enregistrée.';
    end if;

    insert into beta_testers (user_id, status, requested_at)
    values (v_user, 'pending', now())
    on conflict (user_id) do update
    set status = 'pending', requested_at = now(), decided_at = null, seen_at = null;

end;
$$;


create or replace function public.beta_decide(p_user uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    update beta_testers
    set status = case when p_accept then 'accepted' else 'refused' end,
        decided_at = now(),
        seen_at = null
    where user_id = p_user
      and status = 'pending';

    if not found then
        raise exception 'Demande introuvable.';
    end if;

end;
$$;


-- ---------------------------------------------------------
-- Bugs
-- ---------------------------------------------------------

create or replace function public.beta_send_bug(p_group uuid, p_topic text, p_text text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    perform public.beta_check_sender(p_group);

    if p_topic not in (
        'Paris : créer / valider',
        'Mise : Simple / Combinée',
        'Profil : XP, flammes, argent, pièces',
        'Affichage / téléphone',
        'Autre'
    ) then
        raise exception 'Choisis où tu as vu le problème.';
    end if;

    if char_length(trim(coalesce(p_text, ''))) < 5 then
        raise exception 'Explique un peu plus ce qui s''est passé.';
    end if;

    insert into beta_bugs (user_id, group_id, topic, text)
    values (v_user, p_group, p_topic, left(trim(p_text), 600));

    update beta_testers set contributions = contributions + 1 where user_id = v_user;

    perform public.beta_credit(v_user, p_group, 10);

    return 10;

end;
$$;


create or replace function public.beta_fix_bug(p_bug bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_bug record;
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    update beta_bugs
    set status = 'fixed', decided_at = now(), seen_at = null
    where id = p_bug
      and status = 'sent'
    returning user_id, group_id into v_bug;

    if not found then
        raise exception 'Bug introuvable ou déjà corrigé.';
    end if;

    perform public.beta_credit(v_bug.user_id, v_bug.group_id, 50);

end;
$$;


-- Bug rejeté (pas un bug, déjà signalé…) : aucun point.
create or replace function public.beta_reject_bug(p_bug bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    update beta_bugs
    set status = 'rejected', decided_at = now(), seen_at = null
    where id = p_bug
      and status = 'sent';

    if not found then
        raise exception 'Bug introuvable ou déjà traité.';
    end if;

end;
$$;


-- ---------------------------------------------------------
-- Idées
-- ---------------------------------------------------------

create or replace function public.beta_send_idea(p_group uuid, p_kind text, p_text text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    perform public.beta_check_sender(p_group);

    if p_kind not in ('feature', 'design') then
        raise exception 'Choisis Fonctionnalité ou Design.';
    end if;

    if char_length(trim(coalesce(p_text, ''))) < 5 then
        raise exception 'Décris ton idée en quelques mots.';
    end if;

    insert into beta_ideas (user_id, group_id, kind, text)
    values (v_user, p_group, p_kind, left(trim(p_text), 300));

    update beta_testers set contributions = contributions + 1 where user_id = v_user;

    perform public.beta_credit(v_user, p_group, 10);

    return 10;

end;
$$;


create or replace function public.beta_toggle_like(p_idea bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    if not public.beta_has_access() then
        raise exception 'Réservé aux bêta-testeurs.';
    end if;

    if exists (select 1 from beta_ideas where id = p_idea and user_id = v_user) then
        raise exception 'C''est ta propre idée.';
    end if;

    if not exists (select 1 from beta_ideas where id = p_idea) then
        raise exception 'Idée introuvable.';
    end if;

    delete from beta_idea_likes where idea_id = p_idea and user_id = v_user;

    if found then
        return false;
    end if;

    insert into beta_idea_likes (idea_id, user_id) values (p_idea, v_user);

    return true;

end;
$$;


create or replace function public.beta_decide_idea(p_idea bigint, p_keep boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_idea record;
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    update beta_ideas
    set status = case when p_keep then 'kept' else 'rejected' end,
        decided_at = now(),
        seen_at = null
    where id = p_idea
      and status = 'sent'
    returning user_id, group_id into v_idea;

    if not found then
        raise exception 'Idée introuvable ou déjà traitée.';
    end if;

    if p_keep then
        perform public.beta_credit(v_idea.user_id, v_idea.group_id, 150);
    end if;

end;
$$;


-- Notifications vues : réponses de l'admin (accès, bugs corrigés, idées traitées).
create or replace function public.beta_mark_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    update beta_testers set seen_at = now()
    where user_id = v_user and decided_at is not null and seen_at is null;

    update beta_bugs set seen_at = now()
    where user_id = v_user and status <> 'sent' and seen_at is null;

    update beta_ideas set seen_at = now()
    where user_id = v_user and status <> 'sent' and seen_at is null;

end;
$$;


-- ---------------------------------------------------------
-- Journal et vote du vendredi
-- ---------------------------------------------------------

create or replace function public.beta_add_news(p_title text, p_kind text, p_idea bigint default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    if p_kind not in ('feature', 'design') then
        raise exception 'Choisis Fonctionnalité ou Design.';
    end if;

    if char_length(trim(coalesce(p_title, ''))) < 2 then
        raise exception 'Donne un titre à la nouveauté.';
    end if;

    insert into beta_news (title, kind, idea_id, author_id)
    values (
        left(trim(p_title), 80),
        p_kind,
        p_idea,
        (select user_id from beta_ideas where id = p_idea)
    );

end;
$$;


create or replace function public.beta_delete_news(p_news bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    delete from beta_news where id = p_news;

end;
$$;


-- Vote ouvert du vendredi au dimanche (heure de Paris), parmi les nouveautés de la semaine.
create or replace function public.beta_vote(p_group uuid, p_news bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_week date := public.beta_week_start();
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if extract(isodow from now() at time zone 'Europe/Paris') < 5 then
        raise exception 'Le vote ouvre vendredi.';
    end if;

    if not exists (
        select 1 from beta_news
        where id = p_news
          and (created_at at time zone 'Europe/Paris')::date >= v_week
    ) then
        raise exception 'Cette nouveauté n''est pas de cette semaine.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    insert into beta_votes (week_start, user_id, news_id)
    values (v_week, v_user, p_news)
    on conflict do nothing;

    if not found then
        raise exception 'Tu as déjà voté cette semaine.';
    end if;

    perform public.beta_credit(v_user, p_group, 5);

    return 5;

end;
$$;


-- Dépouille les semaines passées : +100 à l'auteur de l'idée élue
-- (dans le groupe où il l'avait proposée). Lancé par le site au chargement.
create or replace function public.beta_settle_votes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_week record;
    v_winner record;
begin

    for v_week in
        select distinct week_start
        from beta_votes
        where week_start < public.beta_week_start()
          and week_start not in (select week_start from beta_vote_results)
    loop

        select n.id, i.user_id, i.group_id
        into v_winner
        from beta_votes v
        join beta_news n on n.id = v.news_id
        left join beta_ideas i on i.id = n.idea_id
        where v.week_start = v_week.week_start
        group by n.id, i.user_id, i.group_id
        order by count(*) desc, min(v.created_at)
        limit 1;

        insert into beta_vote_results (week_start, news_id)
        values (v_week.week_start, v_winner.id)
        on conflict do nothing;

        if found and v_winner.user_id is not null then
            perform public.beta_credit(v_winner.user_id, v_winner.group_id, 100);
        end if;

    end loop;

end;
$$;


-- ---------------------------------------------------------
-- Boutique : 4 nouveaux pseudos animés (et plus de « titre à côté du pseudo »)
-- ---------------------------------------------------------

create or replace function public.buy_cosmetic(p_group uuid, p_item text, p_option text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_price integer;
    v_options text[];
    v_member record;
    v_owned boolean;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select price, options
    into v_price, v_options
    from (values
        ('emoji',        15,  array['🔥', '⚡', '🍀', '🦊', '💎', '🎯']),
        ('neon',         80,  array['rose', 'bleu', 'vert', 'jaune']),
        ('metal_rose',   100, null::text[]),
        ('metal_bronze', 150, null::text[]),
        ('metal_argent', 200, null::text[]),
        ('metal_or',     250, null::text[]),
        ('aura',         300, null::text[]),
        ('etincelles',   100, null::text[]),
        ('theme',        450, array['galaxie', 'carbone', 'sunset']),
        ('clic_perroquet', 30, null::text[]),
        ('clic_perroquet_x3', 80, null::text[]),
        ('scanner',        80,  null::text[]),
        ('neon_anime',     250, null::text[]),
        ('fiole',          280, null::text[]),
        ('ruban_chantier', 300, null::text[])
    ) as catalogue(item, price, options)
    where item = p_item;

    if v_price is null then
        raise exception 'Cosmétique inconnu.';
    end if;

    if v_options is not null and not (p_option = any (v_options)) then
        raise exception 'Choisis une option valide.';
    end if;

    select points, cosmetics into v_member
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    v_owned := (v_member.cosmetics -> p_item ->> 'until')::timestamptz > now();


    -- Déjà possédé : seul un changement d'option (gratuit) est possible.
    if v_owned then

        if v_options is null or (v_member.cosmetics -> p_item ->> 'option') = p_option then
            raise exception 'Tu possèdes déjà cet article.';
        end if;

        update group_members
        set cosmetics = jsonb_set(cosmetics, array[p_item, 'option'], to_jsonb(p_option))
        where group_id = p_group
          and user_id = v_user;

        return 'option';

    end if;


    if v_member.points < v_price then
        raise exception 'Il te manque % points.', v_price - v_member.points;
    end if;

    update group_members
    set points = points - v_price,
        cosmetics = cosmetics || jsonb_build_object(
            p_item,
            jsonb_build_object('until', '9999-12-31T00:00:00Z', 'option', p_option)
        )
    where group_id = p_group
      and user_id = v_user;

    return 'achat';

end;
$$;
