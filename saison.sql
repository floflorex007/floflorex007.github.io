-- =========================================================
-- BetLab : passe de combat (version bêta)
--
-- Une saison = un mois (heure de Paris), 30 niveaux de 100 XP.
-- Le niveau atteint = XP de la saison / 100 (arrondi en dessous).
--
-- XP de saison (multipliée par la flamme au moment du gain) :
--   miser +20, pari gagné récupéré +30, créer un pari +15
--   (3 fois par jour max), venir sur le site +10 par jour.
-- Flamme : ×1,2 à 3 jours, ×1,5 à 7, ×1,75 à 15, ×2 à 30.
--
-- Deux pistes de récompenses, cosmétiques seulement : classique
-- et Gold (plus voyantes). Le Gold est activé par l'admin
-- (gratuit pendant la bêta). Une récompense se récupère dans le
-- groupe en cours : l'argent va sur le solde de ce groupe et les
-- cosmétiques s'ajoutent à ceux de ce groupe (mêmes articles que
-- la boutique, voir groupes-progression.sql).
--
-- Règle de la bêta : ce script ne fait que des AJOUTS (tables,
-- fonctions, triggers). Rien de ce qu'utilise la version classique
-- n'est modifié. Les triggers comptent l'XP de saison de tout le
-- monde, version classique comprise.
--
-- À lancer après groupes-progression.sql et serie-protection.sql.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Saison en cours et multiplicateur de flamme
-- ---------------------------------------------------------

create or replace function public.current_season()
returns text
language sql
stable
as $$
    select to_char(now() at time zone 'Europe/Paris', 'YYYY-MM');
$$;

create or replace function public.flame_mult(p_streak integer)
returns numeric
language sql
immutable
as $$
    select case
        when p_streak >= 30 then 2
        when p_streak >= 15 then 1.75
        when p_streak >= 7 then 1.5
        when p_streak >= 3 then 1.2
        else 1
    end;
$$;


-- ---------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------

-- Chaque gain d'XP de saison (une seule fois par action : unique).
create table if not exists public.season_xp (
    id bigserial primary key,
    user_id uuid not null references public.profiles (id) on delete cascade,
    season text not null,
    reason text not null check (reason in ('mise', 'gain', 'creation', 'connexion')),
    ref text not null,
    amount integer not null,
    created_at timestamptz not null default now(),
    unique (user_id, reason, ref)
);

create index if not exists season_xp_user_season_idx on public.season_xp (user_id, season);

-- Récompenses de chaque niveau (les mêmes chaque mois pour l'instant).
create table if not exists public.season_rewards (
    tier integer not null check (tier between 1 and 30),
    track text not null check (track in ('classique', 'gold')),
    kind text not null check (kind in ('argent', 'cosmetique')),
    item text,
    opt text,
    amount integer,
    label text not null,
    icon text not null,
    primary key (tier, track),
    -- Le Gold ne donne jamais d'argent (cosmétique seulement).
    check (track = 'classique' or kind = 'cosmetique')
);

-- Récompense « pass Gold » (item pass_gold) : opt = 'now' (saison en cours)
-- ou 'next' (saison suivante). Le Gold ne donne jamais d'argent.
alter table public.season_rewards drop constraint if exists season_rewards_kind_check;
alter table public.season_rewards drop constraint if exists season_rewards_check;
alter table public.season_rewards add constraint season_rewards_kind_check
    check (kind in ('argent', 'cosmetique', 'pass_gold'));
alter table public.season_rewards add constraint season_rewards_check
    check (track = 'classique' or kind <> 'argent');

-- Joueurs qui ont le passe Gold pour une saison.
create table if not exists public.season_gold (
    user_id uuid not null references public.profiles (id) on delete cascade,
    season text not null,
    granted_at timestamptz not null default now(),
    primary key (user_id, season)
);

-- Récompenses déjà récupérées.
create table if not exists public.season_claims (
    user_id uuid not null references public.profiles (id) on delete cascade,
    season text not null,
    tier integer not null,
    track text not null,
    group_id uuid references public.groups (id) on delete set null,
    claimed_at timestamptz not null default now(),
    primary key (user_id, season, tier, track)
);


-- ---------------------------------------------------------
-- 3. Sécurité : lecture seulement, tout passe par les fonctions
-- ---------------------------------------------------------

alter table public.season_xp enable row level security;
alter table public.season_rewards enable row level security;
alter table public.season_gold enable row level security;
alter table public.season_claims enable row level security;

drop policy if exists "season_xp lecture" on public.season_xp;
create policy "season_xp lecture" on public.season_xp
    for select using (user_id = auth.uid());

drop policy if exists "season_rewards lecture" on public.season_rewards;
create policy "season_rewards lecture" on public.season_rewards
    for select using (auth.uid() is not null);

drop policy if exists "season_gold lecture" on public.season_gold;
create policy "season_gold lecture" on public.season_gold
    for select using (
        user_id = auth.uid()
        or exists (select 1 from profiles where id = auth.uid() and is_admin)
    );

drop policy if exists "season_claims lecture" on public.season_claims;
create policy "season_claims lecture" on public.season_claims
    for select using (user_id = auth.uid());


-- ---------------------------------------------------------
-- 4. Gain d'XP de saison (appelé par les triggers)
-- ---------------------------------------------------------

create or replace function public.season_xp_add(p_user uuid, p_reason text, p_ref text, p_base integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_streak integer;
begin

    if p_user is null then
        return;
    end if;

    select streak_days into v_streak from profiles where id = p_user;

    insert into season_xp (user_id, season, reason, ref, amount)
    values (p_user, current_season(), p_reason, p_ref, round(p_base * flame_mult(coalesce(v_streak, 0))))
    on conflict (user_id, reason, ref) do nothing;

end;
$$;


-- Miser : +20.
create or replace function public.season_on_stake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    perform season_xp_add(new.user_id, 'mise', new.id::text, 20);

    return new;

end;
$$;

drop trigger if exists season_on_stake on public.stakes;
create trigger season_on_stake
    after insert on public.stakes
    for each row execute function public.season_on_stake();


-- Pari gagné, au moment où le joueur récupère ses gains : +30.
create or replace function public.season_on_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    if old.claimed_at is null
        and new.claimed_at is not null
        and exists (
            select 1 from bets
            where id = new.bet_id
              and winner_choice_id = new.choice_id
        )
    then
        perform season_xp_add(new.user_id, 'gain', new.id::text, 30);
    end if;

    return new;

end;
$$;

drop trigger if exists season_on_claim on public.stakes;
create trigger season_on_claim
    after update of claimed_at on public.stakes
    for each row execute function public.season_on_claim();


-- Créer un pari : +15, 3 fois par jour max.
create or replace function public.season_on_bet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    if (
        select count(*) from season_xp
        where user_id = new.author_id
          and reason = 'creation'
          and (created_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date
    ) < 3 then
        perform season_xp_add(new.author_id, 'creation', new.id::text, 15);
    end if;

    return new;

end;
$$;

drop trigger if exists season_on_bet on public.bets;
create trigger season_on_bet
    after insert on public.bets
    for each row execute function public.season_on_bet();


-- Venir sur le site (connexion du jour, voir daily_checkin) : +10.
create or replace function public.season_on_checkin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    if new.last_checkin is not null
        and new.last_checkin is distinct from old.last_checkin
    then
        perform season_xp_add(new.id, 'connexion', new.last_checkin::text, 10);
    end if;

    return new;

end;
$$;

drop trigger if exists season_on_checkin on public.profiles;
create trigger season_on_checkin
    after update of last_checkin on public.profiles
    for each row execute function public.season_on_checkin();


-- ---------------------------------------------------------
-- 5. XP et Gold d'un joueur (admin : XP infinie et Gold d'office)
-- ---------------------------------------------------------

create or replace function public.season_xp_of(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select case
        when exists (select 1 from profiles where id = p_user and is_admin) then 30 * 100
        else (
            select coalesce(sum(amount), 0)::integer
            from season_xp
            where user_id = p_user and season = current_season()
        )
    end;
$$;


-- Passe Gold de la saison en cours (admin : toujours).
create or replace function public.season_has_gold(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from profiles where id = p_user and is_admin)
        or exists (select 1 from season_gold where user_id = p_user and season = current_season());
$$;


-- ---------------------------------------------------------
-- 6. État du passe pour le joueur connecté
-- ---------------------------------------------------------

create or replace function public.season_status()
returns json
language sql
stable
security definer
set search_path = public
as $$
    select json_build_object(
        'season', current_season(),
        'xp', season_xp_of(auth.uid()),
        'admin', exists (select 1 from profiles where id = auth.uid() and is_admin),
        'gold', season_has_gold(auth.uid()),
        'claims', coalesce((
            select json_agg(json_build_object('tier', tier, 'track', track))
            from season_claims
            where user_id = auth.uid() and season = current_season()
        ), '[]'::json),
        'ends_at', (
            (date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month')
            at time zone 'Europe/Paris'
        )
    );
$$;


-- ---------------------------------------------------------
-- 7. Récupérer une récompense (dans le groupe en cours)
-- ---------------------------------------------------------

create or replace function public.season_claim(p_group uuid, p_tier integer, p_track text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_season text := current_season();
    v_xp integer;
    v_reward record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select * into v_reward from season_rewards where tier = p_tier and track = p_track;

    if not found then
        raise exception 'Récompense inconnue.';
    end if;

    v_xp := season_xp_of(v_user);

    if v_xp / 100 < p_tier then
        raise exception 'Niveau % pas encore atteint.', p_tier;
    end if;

    if p_track = 'gold' and not season_has_gold(v_user) then
        raise exception 'Il faut le passe Gold pour cette récompense.';
    end if;

    insert into season_claims (user_id, season, tier, track, group_id)
    values (v_user, v_season, p_tier, p_track, p_group)
    on conflict do nothing;

    if not found then
        raise exception 'Récompense déjà récupérée.';
    end if;

    if v_reward.kind = 'argent' then

        update group_members
        set balance = balance + v_reward.amount
        where group_id = p_group and user_id = v_user;

    elsif v_reward.kind = 'pass_gold' then

        -- Pass Gold : saison en cours (opt = 'now') ou saison suivante ('next').
        insert into season_gold (user_id, season)
        values (
            v_user,
            case when v_reward.opt = 'next'
                then to_char(date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month', 'YYYY-MM')
                else v_season
            end
        )
        on conflict do nothing;

    elsif v_reward.item = 'cadre' then

        -- Cadre doré (même champ que la boutique), réactivé s'il était retiré.
        update group_members
        set gold_frame_until = '9999-12-31T00:00:00Z',
            cosmetics = cosmetics - 'cadre'
        where group_id = p_group and user_id = v_user;

    elsif v_reward.item = 'couleur' then

        -- Pseudo arc-en-ciel.
        update group_members
        set name_color_until = '9999-12-31T00:00:00Z',
            cosmetics = cosmetics - 'couleur'
        where group_id = p_group and user_id = v_user;

    elsif v_reward.item in ('cristal', 'cadre_diamant', 'emoji_diamant', 'theme_diamant', 'skin_cristal') then

        -- Objets « diamant » : communs à tous les groupes (diamants.sql).
        perform set_config('betlab.allow_points', 'on', true);

        update profiles
        set diamond_items = diamond_items || jsonb_build_object(v_reward.item, jsonb_build_object('off', false))
        where id = v_user;

        perform set_config('betlab.allow_points', 'off', true);

    else

        -- Même format que la boutique ; l'article est équipé tout de suite.
        -- Aussi pour les skins du perroquet (skin_flamant...) et les pseudos
        -- pseudo_flamme / pseudo_terminal / pseudo_glitch (lus par beta.js).
        -- « owned » garde toutes les options gagnées (emoji 🍀 puis ⚡...),
        -- pour pouvoir en changer plus tard sans rien perdre.
        update group_members
        set cosmetics = cosmetics || jsonb_build_object(
            v_reward.item,
            jsonb_build_object(
                'until', '9999-12-31T00:00:00Z',
                'option', v_reward.opt,
                'owned', (
                    select coalesce(jsonb_agg(distinct option), '[]'::jsonb)
                    from jsonb_array_elements(
                        coalesce(cosmetics -> v_reward.item -> 'owned', '[]'::jsonb)
                        || coalesce(cosmetics -> v_reward.item -> 'option', '[]'::jsonb)
                        || coalesce(to_jsonb(v_reward.opt), '[]'::jsonb)
                    ) as owned (option)
                    where option <> 'null'::jsonb
                )
            )
        )
        where group_id = p_group and user_id = v_user;

    end if;

    return v_reward.label;

end;
$$;


-- ---------------------------------------------------------
-- 8. Admin : activer ou retirer le Gold d'un joueur (saison en cours)
-- ---------------------------------------------------------

create or replace function public.admin_set_season_gold(p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    if p_on then
        insert into season_gold (user_id, season)
        values (p_user, current_season())
        on conflict do nothing;
    else
        delete from season_gold
        where user_id = p_user and season = current_season();
    end if;

end;
$$;


-- ---------------------------------------------------------
-- 8 bis. Admin : choisir la récompense d'un niveau (onglet Pass,
--        bouton « Choisir les récompenses »). p_item null = case vide.
-- ---------------------------------------------------------

create or replace function public.admin_set_season_reward(
    p_tier integer,
    p_track text,
    p_item text,
    p_opt text,
    p_label text,
    p_icon text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    if p_tier not between 1 and 30 or p_track not in ('classique', 'gold') then
        raise exception 'Niveau ou piste invalide.';
    end if;

    if p_item is null then

        delete from season_rewards where tier = p_tier and track = p_track;

        return;

    end if;

    insert into season_rewards (tier, track, kind, item, opt, amount, label, icon)
    values (
        p_tier, p_track,
        case when p_item = 'pass_gold' then 'pass_gold' else 'cosmetique' end,
        p_item, p_opt, null, p_label, p_icon
    )
    on conflict (tier, track) do update
    set kind = excluded.kind,
        item = excluded.item,
        opt = excluded.opt,
        amount = null,
        label = excluded.label,
        icon = excluded.icon;

end;
$$;


-- ---------------------------------------------------------
-- 9. Récompenses des 30 niveaux (cosmétiques seulement, aperçu dans
--    la case du pass : voir seasonPreviewHtml dans beta.js)
--    Point de départ : l'admin les change ensuite depuis l'onglet Pass.
--    ⚠ Relancer cette partie efface ses choix.
--    Classique : niveaux 2, 5, 8... 29. Gold : niveau 1 puis 3, 6, 9... 30.
-- ---------------------------------------------------------

delete from public.season_rewards;

-- Répartition décidée avec l'admin (2026-10-11) : classique 1 niveau sur 4,
-- Gold 1 sur 2, objets diamant réservés au Gold, aucun doublon, gros lot
-- au niveau 30 des deux côtés : pass Gold tout de suite (classique) et pass
-- Gold du mois prochain (Gold) ; skin Cristal au 29, arc-en-ciel au 21 (Gold). Écritures du
-- classique dans l'ordre bronze (8), argent (12), or (16).
insert into public.season_rewards (tier, track, kind, item, opt, amount, label, icon) values
    (4,  'classique', 'cosmetique', 'emoji',          '🍀',      null, 'Emoji 🍀',             '🍀'),
    (8,  'classique', 'cosmetique', 'metal_bronze',   null,      null, 'Pseudo bronze',        '🥉'),
    (12, 'classique', 'cosmetique', 'metal_argent',   null,      null, 'Pseudo argent',        '🥈'),
    (16, 'classique', 'cosmetique', 'metal_or',       null,      null, 'Pseudo or',            '🥇'),
    (20, 'classique', 'cosmetique', 'skin_flamant',   null,      null, 'Skin Flamant',         '🦩'),
    (24, 'classique', 'cosmetique', 'etincelles',     null,      null, 'Étincelles',           '✨'),
    (28, 'classique', 'cosmetique', 'skin_nuit',      null,      null, 'Skin Bleu nuit',       '🌙'),
    (30, 'classique', 'pass_gold',  'pass_gold',      'now',     null, 'Pass Gold',            '★'),

    (2,  'gold', 'cosmetique', 'emoji',          '🔥',      null, 'Emoji 🔥',             '🔥'),
    (4,  'gold', 'cosmetique', 'neon',           'rose',    null, 'Néon rose',            '💗'),
    (6,  'gold', 'cosmetique', 'metal_rose',     null,      null, 'Pseudo rose gold',     '🌸'),
    (8,  'gold', 'cosmetique', 'cristal',        null,      null, 'Pseudo cristal',       '💠'),
    (10, 'gold', 'cosmetique', 'emoji_diamant',  null,      null, 'Diamant 💎',           '💎'),
    (12, 'gold', 'cosmetique', 'neon_anime',     null,      null, 'Néon animé',           '🌈'),
    (14, 'gold', 'cosmetique', 'skin_violet',    null,      null, 'Skin Violet royal',    '💜'),
    (16, 'gold', 'cosmetique', 'fiole',          null,      null, 'Fiole qui bouillonne', '🧪'),
    (18, 'gold', 'cosmetique', 'skin_noir',      null,      null, 'Skin Noir et or',      '🖤'),
    (20, 'gold', 'cosmetique', 'aura',           null,      null, 'Aura',                 '🌀'),
    (21, 'gold', 'cosmetique', 'couleur',        null,      null, 'Arc-en-ciel',          '🌈'),
    (22, 'gold', 'cosmetique', 'skin_arctique',  null,      null, 'Skin Arctique',        '❄️'),
    (24, 'gold', 'cosmetique', 'theme_diamant',  null,      null, 'Thème Diamant',        '💎'),
    (26, 'gold', 'cosmetique', 'pseudo_flamme',  null,      null, 'Pseudo enflammé',      '🔥'),
    (28, 'gold', 'cosmetique', 'cadre_diamant',  null,      null, 'Cadre diamant',        '💠'),
    (29, 'gold', 'cosmetique', 'skin_cristal',   null,      null, 'Skin Cristal',         '💠'),
    (30, 'gold', 'pass_gold',  'pass_gold',      'next',    null, 'Pass Gold du mois prochain', '★');
