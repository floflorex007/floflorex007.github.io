-- =========================================================
-- BetLab : points, boutique, missions et coffre par groupe
--
-- À lancer après groupes.sql, une seule fois.
--
--   - Points, cosmétiques (boutique), cadre doré, pseudo en
--     couleur et coffre du jour passent dans group_members :
--     un nouveau groupe repart de zéro.
--   - Les missions ne comptent que les mises / paris du groupe,
--     et leurs récupérations sont enregistrées par groupe.
--   - Restent communs à tous les groupes : l'expérience (XP)
--     et la série de connexions.
--   - Migration : chacun garde ses points et cosmétiques
--     actuels dans le premier groupe « BetLab Bureau ».
-- =========================================================


-- ---------------------------------------------------------
-- 1. Nouvelles colonnes et migration
-- ---------------------------------------------------------

alter table public.group_members
    add column if not exists points integer not null default 0,
    add column if not exists cosmetics jsonb not null default '{}'::jsonb,
    add column if not exists gold_frame_until timestamptz,
    add column if not exists name_color_until timestamptz,
    add column if not exists last_chest date;

alter table public.mission_claims
    add column if not exists group_id uuid references public.groups(id) on delete cascade;

do $$
declare
    v_first uuid;
begin

    select id into v_first
    from groups
    order by created_at
    limit 1;

    -- Une seule fois : tant que des récupérations de missions n'ont pas de groupe.
    if exists (select 1 from mission_claims where group_id is null) or not exists (
        select 1 from group_members where points <> 0 or cosmetics <> '{}'::jsonb
    ) then

        update group_members m
        set points = coalesce(p.points, 0),
            cosmetics = coalesce(p.cosmetics, '{}'::jsonb),
            gold_frame_until = p.gold_frame_until,
            name_color_until = p.name_color_until,
            last_chest = p.last_chest
        from profiles p
        where p.id = m.user_id
          and m.group_id = v_first;

        update mission_claims
        set group_id = v_first
        where group_id is null;

    end if;

end;
$$;

alter table public.mission_claims alter column group_id set not null;

alter table public.mission_claims drop constraint if exists mission_claims_pkey;

alter table public.mission_claims
    add constraint mission_claims_pkey primary key (user_id, group_id, mission, period_key);


-- ---------------------------------------------------------
-- 2. Admin : points illimités aussi dans chaque groupe
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
        new.points := greatest(new.points, 1000000000);
    end if;

    return new;

end;
$$;

update group_members m
set points = m.points
from profiles p
where p.id = m.user_id
  and p.is_admin;


-- ---------------------------------------------------------
-- 3. Anciennes versions (sans groupe) supprimées
-- ---------------------------------------------------------

drop function if exists public.buy_cosmetic(text, text);
drop function if exists public.buy_reward(text);
drop function if exists public.toggle_cosmetic(text, boolean);
drop function if exists public.claim_mission(text);
drop function if exists public.mission_progress();
drop function if exists public.mission_eval(uuid, text);
drop function if exists public.open_daily_chest();
drop function if exists public.daily_checkin();


-- ---------------------------------------------------------
-- 4. Boutique
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
        ('titre',        20,  array['Le Prophète', 'Chanceux', 'Outsider', 'Requin', 'Débutant']),
        ('metal_rose',   100, null::text[]),
        ('metal_bronze', 150, null::text[]),
        ('metal_argent', 200, null::text[]),
        ('metal_or',     250, null::text[]),
        ('aura',         300, null::text[]),
        ('etincelles',   100, null::text[]),
        ('theme',        450, array['galaxie', 'carbone', 'sunset'])
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


create or replace function public.buy_reward(p_group uuid, p_reward text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_price integer;
    v_member record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    v_price := case p_reward
        when 'cadre' then 250
        when 'couleur' then 100
    end;

    if v_price is null then
        raise exception 'Avantage inconnu.';
    end if;

    select points, gold_frame_until, name_color_until into v_member
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if (p_reward = 'cadre' and v_member.gold_frame_until > now())
        or (p_reward = 'couleur' and v_member.name_color_until > now())
    then
        raise exception 'Tu possèdes déjà cet article.';
    end if;

    if v_member.points < v_price then
        raise exception 'Il te manque % points.', v_price - v_member.points;
    end if;

    if p_reward = 'cadre' then

        update group_members
        set points = points - v_price,
            gold_frame_until = '9999-12-31T00:00:00Z'
        where group_id = p_group
          and user_id = v_user;

    else

        update group_members
        set points = points - v_price,
            name_color_until = '9999-12-31T00:00:00Z'
        where group_id = p_group
          and user_id = v_user;

    end if;

end;
$$;


create or replace function public.toggle_cosmetic(p_group uuid, p_item text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_member record;
    v_owned boolean;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select gold_frame_until, name_color_until, cosmetics into v_member
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    v_owned := case p_item
        when 'cadre' then v_member.gold_frame_until > now()
        when 'couleur' then v_member.name_color_until > now()
        else (v_member.cosmetics -> p_item ->> 'until')::timestamptz > now()
    end;

    if not coalesce(v_owned, false) then
        raise exception 'Tu ne possèdes pas cet article.';
    end if;

    update group_members
    set cosmetics = cosmetics || jsonb_build_object(
        p_item,
        coalesce(cosmetics -> p_item, '{}'::jsonb) || jsonb_build_object('off', not p_on)
    )
    where group_id = p_group
      and user_id = v_user;

end;
$$;


-- ---------------------------------------------------------
-- 5. Missions (seulement les paris du groupe)
-- ---------------------------------------------------------

create or replace function public.mission_eval(p_user uuid, p_group uuid, p_mission text, out progress numeric, out target numeric, out keys text[])
returns record
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_week date := date_trunc('week', v_today)::date;
    v_day_start timestamptz := v_today::timestamp at time zone 'Europe/Paris';
    v_week_start timestamptz := v_week::timestamp at time zone 'Europe/Paris';
    v_day_key text := 'J' || v_today::text;
    v_week_key text := 'S' || v_week::text;
    v_reset timestamptz := coalesce(
        (select value from app_settings where key = 'missions_reset_at'),
        '-infinity'::timestamptz
    );
begin

    -- Rien avant la dernière réinitialisation ne compte.
    v_day_start := greatest(v_day_start, v_reset);
    v_week_start := greatest(v_week_start, v_reset);

    keys := '{}';

    if p_mission = 'connexion' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'touche' then

        target := 3;

        select count(distinct s.bet_id) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'premier' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start
          and not exists (
              select 1 from stakes o
              where o.bet_id = s.bet_id
                and o.created_at < s.created_at
          );

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'gros' then

        target := 700;

        select coalesce(sum(s.stake), 0) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_week_start;

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'createur' then

        target := 5;

        -- Les mises du créateur sur son propre pari comptent aussi.
        select coalesce(max(n), 0) into progress
        from (
            select count(distinct s.user_id) as n
            from bets b
            join stakes s on s.bet_id = b.id
            where b.author_id = p_user
              and b.group_id = p_group
              and b.created_at >= v_week_start
            group by b.id
        ) t;

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'premier_gain' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and b.status = 'resolved'
          and s.created_at >= v_reset
          and b.winner_choice_id = s.choice_id;

        if progress >= target then keys := array['unique']; end if;

    elsif p_mission = 'outsider' then

        target := 1;

        keys := array(
            select distinct s.bet_id::text
            from stakes s
            join bets b on b.id = s.bet_id
            join bet_choices c on c.id = s.choice_id
            where s.user_id = p_user
              and b.group_id = p_group
              and b.status = 'resolved'
              and s.created_at >= v_reset
              and b.winner_choice_id = s.choice_id
              and c.odds > 3
        );

        progress := cardinality(keys);

    elsif p_mission = 'contre' then

        target := 1;

        -- Le choix gagnant doit avoir strictement moins de mises
        -- que chacun des autres choix du pari.
        keys := array(
            select distinct s.bet_id::text
            from stakes s
            join bets b on b.id = s.bet_id
            where s.user_id = p_user
              and b.group_id = p_group
              and b.status = 'resolved'
              and s.created_at >= v_reset
              and b.winner_choice_id = s.choice_id
              and exists (
                  select 1 from bet_choices c2
                  where c2.bet_id = s.bet_id and c2.id <> s.choice_id
              )
              and (select count(*) from stakes x where x.choice_id = s.choice_id)
                  < all (
                      select count(x2.id)
                      from bet_choices c2
                      left join stakes x2 on x2.choice_id = c2.id
                      where c2.bet_id = s.bet_id
                        and c2.id <> s.choice_id
                      group by c2.id
                  )
        );

        progress := cardinality(keys);

    else

        raise exception 'Mission inconnue : %', p_mission;

    end if;

    progress := least(progress, target);

end;
$$;


create or replace function public.mission_progress(p_group uuid)
returns table(mission text, progress numeric, target numeric, claimable integer, claimed integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_mission text;
    v_eval record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    foreach v_mission in array array[
        'connexion', 'touche', 'premier', 'gros',
        'createur', 'premier_gain', 'outsider', 'contre'
    ]
    loop

        select * into v_eval from mission_eval(v_user, p_group, v_mission);

        mission := v_mission;
        progress := v_eval.progress;
        target := v_eval.target;

        select count(*) into claimable
        from unnest(v_eval.keys) k
        where not exists (
            select 1 from mission_claims mc
            where mc.user_id = v_user
              and mc.group_id = p_group
              and mc.mission = v_mission
              and mc.period_key = k
        );

        select count(*) into claimed
        from unnest(v_eval.keys) k
        join mission_claims mc
          on mc.user_id = v_user
         and mc.group_id = p_group
         and mc.mission = v_mission
         and mc.period_key = k;

        return next;

    end loop;

end;
$$;


create or replace function public.claim_mission(p_group uuid, p_mission text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_eval record;
    v_key text;
    v_points integer := mission_points(p_mission);
    v_total integer := 0;
    v_rows integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if v_points is null then
        raise exception 'Mission inconnue.';
    end if;

    -- Verrouille le membre pour éviter deux récupérations simultanées.
    perform 1 from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select * into v_eval from mission_eval(v_user, p_group, p_mission);

    foreach v_key in array v_eval.keys
    loop

        insert into mission_claims (user_id, group_id, mission, period_key, points)
        values (v_user, p_group, p_mission, v_key, v_points)
        on conflict do nothing;

        get diagnostics v_rows = row_count;

        v_total := v_total + v_rows * v_points;

    end loop;

    if v_total = 0 then
        raise exception 'Cette mission n''est pas accomplie ou a déjà été récupérée.';
    end if;

    update group_members
    set points = points + v_total
    where group_id = p_group
      and user_id = v_user;

    return v_total;

end;
$$;


-- ---------------------------------------------------------
-- 6. Série (commune) et coffre du jour (par groupe)
-- ---------------------------------------------------------

create or replace function public.daily_checkin(p_group uuid, out streak integer, out increased boolean, out chest_available boolean)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_profile record;
    v_last_chest date;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select streak_days, last_checkin, is_admin into v_profile
    from profiles
    where id = v_user
    for update;

    increased := v_profile.last_checkin is distinct from v_today;

    if increased then

        streak := case
            when v_profile.last_checkin = v_today - 1 then v_profile.streak_days + 1
            else 1
        end;

        perform set_config('betlab.allow_points', 'on', true);

        update profiles
        set streak_days = streak,
            last_checkin = v_today
        where id = v_user;

        perform set_config('betlab.allow_points', 'off', true);

    else

        streak := v_profile.streak_days;

    end if;

    select last_chest into v_last_chest
    from group_members
    where group_id = p_group
      and user_id = v_user;

    -- L'administrateur peut ouvrir le coffre sans limite.
    chest_available := found
        and (v_last_chest is distinct from v_today or v_profile.is_admin);

end;
$$;


create or replace function public.open_daily_chest(p_group uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_last date;
    v_admin boolean;
    v_roll numeric := random();
    v_points integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select is_admin into v_admin from profiles where id = v_user;

    select last_chest into v_last
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if v_last = v_today and not coalesce(v_admin, false) then
        raise exception 'Le coffre du jour est déjà ouvert. Reviens demain !';
    end if;

    v_points := case
        when v_roll < 0.40 then 5
        when v_roll < 0.70 then 10
        when v_roll < 0.90 then 15
        else 20
    end;

    update group_members
    set points = points + v_points,
        last_chest = v_today
    where group_id = p_group
      and user_id = v_user;

    return v_points;

end;
$$;


revoke execute on function public.mission_eval(uuid, uuid, text) from public, anon, authenticated;
