-- =========================================================
-- BetLab : carte des clics (onglet « Heat map » de l'admin)
-- Maquette : Exemple-aide CLAUDE/demo-heatmap-admin.html (version B, calque plein écran)
--
-- - click_events : un clic = une ligne. Ni compte, ni adresse IP,
--   ni texte saisi : l'écran, l'élément cliqué, la position du clic
--   dans cet élément, la largeur de l'écran, le type d'appareil, le niveau
--   du joueur, l'heure (arrondie à l'heure) et
--   un numéro de visite tiré au hasard dans le navigateur.
-- - Ajout : seulement un joueur connecté qui a coché la case d'accord
--   (click_consents), jamais l'admin ni les comptes de click_excluded_users.
-- - Lecture : l'admin seul. La page Heat map passe par trois fonctions
--   qui renvoient des totaux (par élément et par case dans l'élément),
--   jamais les clics un par un.
-- - Purge : les clics de plus de 90 jours sont effacés chaque nuit (pg_cron).
--
-- À lancer après aide-app.sql (beta_is_admin).
-- =========================================================


-- ---------- Accord des joueurs (fenêtre au lancement + interrupteur du Profil) ----------

create table if not exists public.click_consents (
    user_id uuid primary key references auth.users(id) on delete cascade,
    accepted boolean not null,
    decided_at timestamptz not null default now()
);

alter table public.click_consents enable row level security;

drop policy if exists "click_consents lecture" on public.click_consents;

create policy "click_consents lecture"
    on public.click_consents
    for select
    to authenticated
    using (user_id = auth.uid());


-- Comptes jamais comptés en plus de l'admin (aucune règle : invisible depuis le site).
create table if not exists public.click_excluded_users (
    user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.click_excluded_users enable row level security;

-- « Florian » et « Florian1 » : les comptes joueur du créateur de BetLab.
insert into public.click_excluded_users (user_id)
values
    ('f27043d8-44fc-49d4-9b7d-c9c70fe63cd2'),
    ('b96decd2-d860-45f7-af20-b492335fb300')
on conflict do nothing;


-- 'excluded' (admin, compte exclu), 'accepted', 'refused' ou 'unknown' (pas encore répondu).
create or replace function public.my_click_tracking()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when auth.uid() is null then 'excluded'
        when coalesce((select is_admin from profiles where id = auth.uid()), false) then 'excluded'
        when exists (select 1 from click_excluded_users where user_id = auth.uid()) then 'excluded'
        else coalesce(
            (select case when accepted then 'accepted' else 'refused' end from click_consents where user_id = auth.uid()),
            'unknown'
        )
    end;
$$;

create or replace function public.click_tracking_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.my_click_tracking() = 'accepted';
$$;

create or replace function public.set_click_consent(p_accepted boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    insert into click_consents (user_id, accepted, decided_at)
    values (auth.uid(), coalesce(p_accepted, false), now())
    on conflict (user_id) do update
        set accepted = excluded.accepted,
            decided_at = now();

    return public.my_click_tracking();

end;
$$;

revoke all on function public.my_click_tracking() from public, anon;
revoke all on function public.click_tracking_allowed() from public, anon;
revoke all on function public.set_click_consent(boolean) from public, anon;
grant execute on function public.my_click_tracking() to authenticated;
grant execute on function public.click_tracking_allowed() to authenticated;
grant execute on function public.set_click_consent(boolean) to authenticated;


-- ---------- Les clics ----------
-- Chaque clic est accroché à l'élément cliqué (bouton, carte, fond de fenêtre…),
-- pas à l'écran : les joueurs n'ont pas tous le même écran (niveau, nombre de
-- paris, longueur des textes), alors on note
--   element  : la clé de l'élément (sélecteur court, jamais son texte) ;
--   el_index : son rang parmi les éléments identiques visibles (2e carte…) ;
--   ex_pm, ey_pm : la position du clic dans l'élément, en ‰ (0 à 1000) de sa largeur et de sa hauteur.
-- La page Heat map retrouve le même élément sur l'écran de l'admin et y replace les clics.

-- Ancienne version (positions par rapport à l'écran) : effacée pour repartir de zéro (2026-10-19).
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'click_events' and column_name = 'layer'
    ) then
        drop table public.click_events;
    end if;
end;
$$;

create table if not exists public.click_events (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default date_trunc('hour', now()),
    session_id uuid not null,
    screen text not null check (char_length(screen) between 1 and 40),
    element text not null check (char_length(element) between 1 and 80),
    el_index smallint check (el_index between 0 and 99),
    ex_pm smallint not null check (ex_pm between 0 and 1000),
    ey_pm smallint not null check (ey_pm between 0 and 1000),
    vw smallint not null check (vw between 200 and 8000),
    device text not null check (device in ('mobile', 'desktop'))
);

-- Niveau du joueur au moment du clic (celui qui décide des déblocages de l'écran,
-- voir applyLevelLocks) : pour comparer les écrans d'un niveau à l'autre.
-- Ajouté le 2026-10-19 : vide pour les clics d'avant.
alter table public.click_events
    add column if not exists level smallint check (level between 1 and 99);

-- Clic dans le vide : sur rien de cliquable (ni bouton, ni curseur « main »)
-- ou sur un bouton grisé. Le joueur croyait que ça marchait.
-- Ajouté le 2026-10-19 : vide pour les clics d'avant.
alter table public.click_events
    add column if not exists dead boolean;

create index if not exists click_events_created_at on public.click_events (created_at);
create index if not exists click_events_screen_created_at on public.click_events (screen, created_at);

alter table public.click_events enable row level security;

drop policy if exists "click_events ajout" on public.click_events;
drop policy if exists "click_events lecture admin" on public.click_events;

create policy "click_events ajout"
    on public.click_events
    for insert
    to authenticated
    with check (public.click_tracking_allowed());

create policy "click_events lecture admin"
    on public.click_events
    for select
    to authenticated
    using (public.beta_is_admin());


-- Heure arrondie à l'heure (plus anonyme, et impossible d'inventer une date),
-- et garde-fou contre un envoi en boucle : 40 000 clics par jour au maximum.
create or replace function public.click_events_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    new.created_at := date_trunc('hour', now());

    if (select count(*) from click_events where created_at >= date_trunc('day', now())) >= 40000 then
        return null;
    end if;

    return new;

end;
$$;

drop trigger if exists click_events_before_insert on public.click_events;

create trigger click_events_before_insert
    before insert on public.click_events
    for each row
    execute function public.click_events_before_insert();


-- ---------- Totaux pour la page Heat map (admin seulement) ----------

-- Groupes de largeur calés sur le site : version téléphone (≤ 800 px ou forcée),
-- portable (801 à 1100 px, sans colonne de droite), grand écran (3 colonnes).
create or replace function public.click_bucket(p_device text, p_vw integer)
returns text
language sql
immutable
as $$
    select case
        when p_device = 'mobile' then 'phone'
        when p_vw <= 1100 then 'laptop'
        else 'wide'
    end;
$$;

-- « Aujourd'hui » part de minuit (heure de Paris), sinon les N derniers jours.
create or replace function public.click_since(p_days integer)
returns timestamptz
language sql
stable
as $$
    select case
        when coalesce(p_days, 7) <= 1 then date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'
        else now() - make_interval(days => least(p_days, 90))
    end;
$$;

-- Filtre « Niveau » de la page Heat map : null = tous, 5 = niveau 5 et plus
-- (le dernier déblocage), sinon ce niveau-là. Les clics sans niveau
-- (avant le 2026-10-19) ne comptent que pour « tous ».
create or replace function public.click_level_ok(p_click_level smallint, p_level integer)
returns boolean
language sql
immutable
as $$
    select case
        when p_level is null then true
        when p_level >= 5 then p_click_level >= 5
        else p_click_level = p_level
    end;
$$;

-- Clics additionnés par élément et par case : chaque élément est découpé
-- en cases de p_cell % de sa largeur et de sa hauteur.
drop function if exists public.admin_click_heatmap(text, text, integer, integer);
drop function if exists public.admin_click_heatmap(text, text, integer, integer, integer);

create or replace function public.admin_click_heatmap(p_screen text, p_bucket text, p_days integer, p_cell integer default 2, p_level integer default null)
returns table (element text, el_index smallint, cx integer, cy integer, clicks bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_cell integer := case when p_cell in (1, 2, 4, 5) then p_cell else 2 end;
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    return query
    select e.element,
           e.el_index,
           (least(e.ex_pm, 999) / (v_cell * 10))::integer,
           (least(e.ey_pm, 999) / (v_cell * 10))::integer,
           count(*)
    from click_events e
    where e.screen = p_screen
      and public.click_bucket(e.device, e.vw) = p_bucket
      and e.created_at >= public.click_since(p_days)
      and public.click_level_ok(e.level, p_level)
    group by 1, 2, 3, 4;

end;
$$;

-- Éléments les plus cliqués (p_screen null = tous les écrans).
drop function if exists public.admin_click_ranking(text, text, integer);

create or replace function public.admin_click_ranking(p_screen text, p_bucket text, p_days integer, p_level integer default null)
returns table (element text, clicks bigint, screens text[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    return query
    select e.element,
           count(*),
           array_agg(distinct e.screen)
    from click_events e
    where (p_screen is null or e.screen = p_screen)
      and e.element is not null
      and public.click_bucket(e.device, e.vw) = p_bucket
      and e.created_at >= public.click_since(p_days)
      and public.click_level_ok(e.level, p_level)
    group by e.element
    order by 2 desc
    limit 60;

end;
$$;

-- Chiffres du tiroir : clics et visites de l'écran, écrans qui ont des clics, place prise.
drop function if exists public.admin_click_summary(text, text, integer);

create or replace function public.admin_click_summary(p_screen text, p_bucket text, p_days integer, p_level integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_since timestamptz := public.click_since(p_days);
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    return jsonb_build_object(
        'clicks', (
            select count(*) from click_events e
            where e.screen = p_screen and public.click_bucket(e.device, e.vw) = p_bucket
              and e.created_at >= v_since and public.click_level_ok(e.level, p_level)
        ),
        'visits', (
            select count(distinct e.session_id) from click_events e
            where e.screen = p_screen and public.click_bucket(e.device, e.vw) = p_bucket
              and e.created_at >= v_since and public.click_level_ok(e.level, p_level)
        ),
        'screens', (
            select coalesce(jsonb_agg(jsonb_build_object('screen', s.screen, 'clicks', s.n) order by s.n desc), '[]'::jsonb)
            from (
                select e.screen, count(*) as n from click_events e
                where public.click_bucket(e.device, e.vw) = p_bucket
                  and e.created_at >= v_since and public.click_level_ok(e.level, p_level)
                group by e.screen
            ) s
        ),
        'consents', (select count(*) from click_consents where accepted),
        'rows_total', (select count(*) from click_events),
        'table_bytes', pg_total_relation_size('public.click_events'),
        'db_bytes', pg_database_size(current_database())
    );

end;
$$;


-- ---------- Onglet « Analyses » de la page Heat map ----------
-- Période : du p_from au p_to (avant / après un changement), sinon les p_days derniers jours.

-- Chiffres de la période, sur tous les écrans :
--   clics, visites, clics dans le vide (dead) et les éléments qui en reçoivent le plus,
--   séries de clics répétés : même élément cliqué au moins 3 fois de suite pendant
--   une visite (dans l'ordre d'arrivée des clics), sauf les clés de p_repeat_ok
--   (motifs LIKE : champs de saisie, mises rapides, perroquet… où c'est normal).
create or replace function public.admin_click_analysis(
    p_bucket text,
    p_days integer,
    p_level integer default null,
    p_from timestamptz default null,
    p_to timestamptz default null,
    p_repeat_ok text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_from timestamptz := coalesce(p_from, public.click_since(p_days));
    v_to timestamptz := coalesce(p_to, now() + interval '1 hour');
    v_result jsonb;
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    with e as (
        select c.id, c.session_id, c.screen, c.element, c.el_index, c.dead
        from click_events c
        where public.click_bucket(c.device, c.vw) = p_bucket
          and c.created_at >= v_from
          and c.created_at < v_to
          and public.click_level_ok(c.level, p_level)
    ),
    marked as (
        select e.*,
               case
                   when lag(e.screen) over w = e.screen
                    and lag(e.element) over w = e.element
                    and lag(e.el_index) over w is not distinct from e.el_index
                   then 0 else 1
               end as new_run
        from e
        window w as (partition by e.session_id order by e.id)
    ),
    grouped as (
        select m.*, sum(m.new_run) over (partition by m.session_id order by m.id) as run
        from marked m
    ),
    runs as (
        select g.session_id, g.screen, g.element, count(*) as n
        from grouped g
        where not (g.element like any (coalesce(p_repeat_ok, '{}')))
        group by g.session_id, g.run, g.screen, g.element
        having count(*) >= 3
    )
    select jsonb_build_object(
        'clicks', (select count(*) from e),
        'visits', (select count(distinct session_id) from e),
        'dead_clicks', (select count(*) from e where dead),
        'dead_known', (select count(*) from e where dead is not null),
        'dead', (
            select coalesce(jsonb_agg(jsonb_build_object('screen', d.screen, 'element', d.element, 'clicks', d.n) order by d.n desc), '[]'::jsonb)
            from (
                select screen, element, count(*) as n from e
                where dead
                group by screen, element
                order by n desc
                limit 10
            ) d
        ),
        'repeat_runs', (select count(*) from runs),
        'repeat', (
            select coalesce(jsonb_agg(jsonb_build_object('screen', r.screen, 'element', r.element, 'runs', r.runs, 'visits', r.visits, 'longest', r.longest) order by r.runs desc), '[]'::jsonb)
            from (
                select screen, element, count(*) as runs, count(distinct session_id) as visits, max(n) as longest
                from runs
                group by screen, element
                order by runs desc
                limit 10
            ) r
        )
    ) into v_result;

    return v_result;

end;
$$;

-- Parcours : nombre de visites qui franchissent chaque étape, dans l'ordre
-- (étape 2 cliquée après l'étape 1 pendant la même visite, etc.).
-- p_steps : [{ "element": motif LIKE, "screen": écran ou absent }, …]
create or replace function public.admin_click_funnel(
    p_steps jsonb,
    p_bucket text,
    p_days integer,
    p_level integer default null,
    p_from timestamptz default null,
    p_to timestamptz default null
)
returns bigint[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_from timestamptz := coalesce(p_from, public.click_since(p_days));
    v_to timestamptz := coalesce(p_to, now() + interval '1 hour');
    v_step jsonb;
    v_first boolean := true;
    v_sessions uuid[] := '{}';
    v_ids bigint[] := '{}';
    v_counts bigint[] := '{}';
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    for v_step in select value from jsonb_array_elements(p_steps) loop

        if v_first then

            select coalesce(array_agg(t.session_id), '{}'), coalesce(array_agg(t.id), '{}')
            into v_sessions, v_ids
            from (
                select c.session_id, min(c.id) as id
                from click_events c
                where public.click_bucket(c.device, c.vw) = p_bucket
                  and c.created_at >= v_from and c.created_at < v_to
                  and public.click_level_ok(c.level, p_level)
                  and c.element like (v_step->>'element')
                  and (v_step->>'screen' is null or c.screen = v_step->>'screen')
                group by c.session_id
            ) t;

            v_first := false;

        else

            select coalesce(array_agg(t.session_id), '{}'), coalesce(array_agg(t.id), '{}')
            into v_sessions, v_ids
            from (
                select p.sid as session_id, min(c.id) as id
                from unnest(v_sessions, v_ids) as p(sid, pid)
                join click_events c on c.session_id = p.sid and c.id > p.pid
                where public.click_bucket(c.device, c.vw) = p_bucket
                  and c.created_at >= v_from and c.created_at < v_to
                  and public.click_level_ok(c.level, p_level)
                  and c.element like (v_step->>'element')
                  and (v_step->>'screen' is null or c.screen = v_step->>'screen')
                group by p.sid
            ) t;

        end if;

        v_counts := v_counts || coalesce(array_length(v_sessions, 1), 0)::bigint;

    end loop;

    return v_counts;

end;
$$;


-- Aperçu cliquable de la page Heat map : le site tourne avec le compte admin,
-- mais rien ne doit s'y enregistrer. Le cadre ne laisse passer que les
-- fonctions de lecture : celles déclarées « stable » ou « immutable », que
-- Postgres empêche d'écrire (liste relue à chaque ouverture, donc à jour).
create or replace function public.admin_click_preview_rpcs()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    return array(
        select distinct p.proname::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
          and p.provolatile in ('s', 'i')
    );

end;
$$;

revoke all on function public.admin_click_heatmap(text, text, integer, integer, integer) from public, anon;
revoke all on function public.admin_click_ranking(text, text, integer, integer) from public, anon;
revoke all on function public.admin_click_summary(text, text, integer, integer) from public, anon;
revoke all on function public.admin_click_analysis(text, integer, integer, timestamptz, timestamptz, text[]) from public, anon;
revoke all on function public.admin_click_funnel(jsonb, text, integer, integer, timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_click_preview_rpcs() from public, anon;
grant execute on function public.admin_click_heatmap(text, text, integer, integer, integer) to authenticated;
grant execute on function public.admin_click_ranking(text, text, integer, integer) to authenticated;
grant execute on function public.admin_click_summary(text, text, integer, integer) to authenticated;
grant execute on function public.admin_click_analysis(text, integer, integer, timestamptz, timestamptz, text[]) to authenticated;
grant execute on function public.admin_click_funnel(jsonb, text, integer, integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_click_preview_rpcs() to authenticated;


-- ---------- Purge automatique : clics de plus de 90 jours, chaque nuit à 3 h 20 (UTC) ----------

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
    'betlab-purge-clics',
    '20 3 * * *',
    $$delete from public.click_events where created_at < now() - interval '90 days'$$
);
