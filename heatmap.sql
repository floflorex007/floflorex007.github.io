-- =========================================================
-- BetLab : carte des clics (onglet « Heat map » de l'admin)
-- Maquette : Exemple-aide CLAUDE/demo-heatmap-admin.html (version B, calque plein écran)
--
-- - click_events : un clic = une ligne. Ni compte, ni adresse IP,
--   ni texte saisi : l'écran, l'élément cliqué, la position, la taille
--   de l'écran, le type d'appareil, l'heure (arrondie à l'heure) et
--   un numéro de visite tiré au hasard dans le navigateur.
-- - Ajout : seulement un joueur connecté qui a coché la case d'accord
--   (click_consents), jamais l'admin ni les comptes de click_excluded_users.
-- - Lecture : l'admin seul. La page Heat map passe par trois fonctions
--   qui renvoient des totaux (par case de grille et par élément),
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
-- Positions en ‰ (pour mille, 0 à 1000) :
--   layer 'page'  : dans la zone centrale (.main-container, 1300 px au plus) → x / largeur de cette zone,
--                   y / hauteur de la page, et y_px = distance au haut de la page ;
--   layer 'top'   : ailleurs dans la page (barre du haut) → x / largeur de l'écran, y et y_px pareil ;
--   layer 'fixed' : élément fixe (menu du bas, bulle du chat…) ou fond d'une fenêtre → x et y / taille de l'écran ;
--   layer 'modal' : dans une fenêtre → x et y / taille de la fenêtre.

create table if not exists public.click_events (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default date_trunc('hour', now()),
    session_id uuid not null,
    screen text not null check (char_length(screen) between 1 and 40),
    element text check (char_length(element) <= 80),
    layer text not null default 'page',
    x_pm smallint not null check (x_pm between 0 and 1000),
    y_pm smallint not null check (y_pm between 0 and 1000),
    y_px integer check (y_px between 0 and 200000),
    vw smallint not null check (vw between 200 and 8000),
    vh smallint not null check (vh between 200 and 8000),
    device text not null check (device in ('mobile', 'desktop'))
);

-- Contraintes nommées (relançable, et mise à jour de la première version de la table).
alter table public.click_events drop constraint if exists click_events_layer_check;
alter table public.click_events drop constraint if exists click_events_check;
alter table public.click_events drop constraint if exists click_events_y_px_needed;

alter table public.click_events
    add constraint click_events_layer_check check (layer in ('page', 'top', 'fixed', 'modal'));

alter table public.click_events
    add constraint click_events_y_px_needed check (layer not in ('page', 'top') or y_px is not null);

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

-- Clics additionnés par case de grille : colonnes de p_cell % de large ;
-- lignes de p_cell_px pixels dans la page (y_px, pour rester aligné quelle que
-- soit la longueur de la page), de p_cell % de haut sur l'écran ou dans une fenêtre.
drop function if exists public.admin_click_heatmap(text, text, integer, integer);

create or replace function public.admin_click_heatmap(p_screen text, p_bucket text, p_days integer, p_cell integer default 2, p_cell_px integer default 20)
returns table (layer text, cx integer, cy integer, clicks bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_cell integer := case when p_cell in (1, 2, 4) then p_cell else 2 end;
    v_cell_px integer := greatest(4, least(coalesce(p_cell_px, 20), 200));
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    return query
    select e.layer,
           (least(e.x_pm, 999) / (v_cell * 10))::integer,
           (case
               when e.layer in ('page', 'top') then e.y_px / v_cell_px
               else least(e.y_pm, 999) / (v_cell * 10)
           end)::integer,
           count(*)
    from click_events e
    where e.screen = p_screen
      and public.click_bucket(e.device, e.vw) = p_bucket
      and e.created_at >= public.click_since(p_days)
    group by 1, 2, 3;

end;
$$;

-- Éléments les plus cliqués (p_screen null = tous les écrans).
create or replace function public.admin_click_ranking(p_screen text, p_bucket text, p_days integer)
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
    group by e.element
    order by 2 desc
    limit 60;

end;
$$;

-- Chiffres du tiroir : clics et visites de l'écran, écrans qui ont des clics, place prise.
create or replace function public.admin_click_summary(p_screen text, p_bucket text, p_days integer)
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
            where e.screen = p_screen and public.click_bucket(e.device, e.vw) = p_bucket and e.created_at >= v_since
        ),
        'visits', (
            select count(distinct e.session_id) from click_events e
            where e.screen = p_screen and public.click_bucket(e.device, e.vw) = p_bucket and e.created_at >= v_since
        ),
        'screens', (
            select coalesce(jsonb_agg(jsonb_build_object('screen', s.screen, 'clicks', s.n) order by s.n desc), '[]'::jsonb)
            from (
                select e.screen, count(*) as n from click_events e
                where public.click_bucket(e.device, e.vw) = p_bucket and e.created_at >= v_since
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

revoke all on function public.admin_click_heatmap(text, text, integer, integer, integer) from public, anon;
revoke all on function public.admin_click_ranking(text, text, integer) from public, anon;
revoke all on function public.admin_click_summary(text, text, integer) from public, anon;
grant execute on function public.admin_click_heatmap(text, text, integer, integer, integer) to authenticated;
grant execute on function public.admin_click_ranking(text, text, integer) to authenticated;
grant execute on function public.admin_click_summary(text, text, integer) to authenticated;


-- ---------- Purge automatique : clics de plus de 90 jours, chaque nuit à 3 h 20 (UTC) ----------

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
    'betlab-purge-clics',
    '20 3 * * *',
    $$delete from public.click_events where created_at < now() - interval '90 days'$$
);
