-- =========================================================
--   BETLAB : MISSIONS ET BOUTIQUE DE POINTS
--   À coller dans Supabase → SQL Editor → Run.
--   Le script peut être relancé sans risque.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Colonnes ajoutées aux profils
-- ---------------------------------------------------------

alter table public.profiles
    add column if not exists points integer not null default 0 check (points >= 0),
    add column if not exists gold_frame_until timestamptz,
    add column if not exists name_color_until timestamptz;


-- ---------------------------------------------------------
-- 2. Missions déjà récupérées
--    period_key : "J2026-10-05" (jour), "S2026-10-05" (semaine),
--    "unique" (une seule fois) ou l'id du pari (missions répétables).
-- ---------------------------------------------------------

create table if not exists public.mission_claims (
    user_id uuid not null references public.profiles(id),
    mission text not null,
    period_key text not null,
    points integer not null,
    claimed_at timestamptz not null default now(),
    primary key (user_id, mission, period_key)
);

alter table public.mission_claims enable row level security;

drop policy if exists "Lire ses missions" on public.mission_claims;

create policy "Lire ses missions"
    on public.mission_claims
    for select
    using (auth.uid() = user_id);


-- ---------------------------------------------------------
-- 3. Protection : points et avantages ne changent
--    que par les fonctions ci-dessous.
-- ---------------------------------------------------------

create or replace function public.protect_profile_points()
returns trigger
language plpgsql
as $$
begin

    if coalesce(current_setting('betlab.allow_points', true), '') <> 'on'
        and (
            new.points is distinct from old.points
            or new.gold_frame_until is distinct from old.gold_frame_until
            or new.name_color_until is distinct from old.name_color_until
        )
    then
        raise exception 'Les points ne peuvent pas être modifiés directement.';
    end if;

    return new;

end;
$$;

drop trigger if exists protect_profile_points on public.profiles;

create trigger protect_profile_points
    before update on public.profiles
    for each row
    execute function public.protect_profile_points();


-- ---------------------------------------------------------
-- 4. Points de chaque mission
-- ---------------------------------------------------------

create or replace function public.mission_points(p_mission text)
returns integer
language sql
immutable
as $$
    select case p_mission
        when 'connexion'    then 5
        when 'touche'       then 5
        when 'premier'      then 5
        when 'gros'         then 20
        when 'createur'     then 25
        when 'premier_gain' then 10
        when 'outsider'     then 20
        when 'contre'       then 30
    end;
$$;


-- ---------------------------------------------------------
-- 4 bis. Date de réinitialisation des missions
--    Seule l'activité (mises, paris) postérieure à cette date
--    compte pour les missions. Voir reinitialisation.sql.
-- ---------------------------------------------------------

create table if not exists public.app_settings (
    key text primary key,
    value timestamptz
);

alter table public.app_settings enable row level security;


-- ---------------------------------------------------------
-- 5. Évaluation d'une mission pour un joueur
--    keys : périodes (ou paris) pour lesquelles
--    la mission est accomplie.
-- ---------------------------------------------------------

create or replace function public.mission_eval(
    p_user uuid,
    p_mission text,
    out progress numeric,
    out target numeric,
    out keys text[]
)
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
        from stakes
        where user_id = p_user
          and created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'touche' then

        target := 3;

        select count(distinct bet_id) into progress
        from stakes
        where user_id = p_user
          and created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'premier' then

        target := 1;

        select count(*) into progress
        from stakes s
        where s.user_id = p_user
          and s.created_at >= v_day_start
          and not exists (
              select 1 from stakes o
              where o.bet_id = s.bet_id
                and o.created_at < s.created_at
          );

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'gros' then

        target := 700;

        select coalesce(sum(stake), 0) into progress
        from stakes
        where user_id = p_user
          and created_at >= v_week_start;

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


-- ---------------------------------------------------------
-- 6. Progression de toutes les missions du joueur connecté
-- ---------------------------------------------------------

create or replace function public.mission_progress()
returns table (
    mission text,
    progress numeric,
    target numeric,
    claimable integer,
    claimed integer
)
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

    foreach v_mission in array array[
        'connexion', 'touche', 'premier', 'gros',
        'createur', 'premier_gain', 'outsider', 'contre'
    ]
    loop

        select * into v_eval from mission_eval(v_user, v_mission);

        mission := v_mission;
        progress := v_eval.progress;
        target := v_eval.target;

        select count(*) into claimable
        from unnest(v_eval.keys) k
        where not exists (
            select 1 from mission_claims mc
            where mc.user_id = v_user
              and mc.mission = v_mission
              and mc.period_key = k
        );

        select count(*) into claimed
        from unnest(v_eval.keys) k
        join mission_claims mc
          on mc.user_id = v_user
         and mc.mission = v_mission
         and mc.period_key = k;

        return next;

    end loop;

end;
$$;


-- ---------------------------------------------------------
-- 7. Récupérer les points d'une mission
-- ---------------------------------------------------------

create or replace function public.claim_mission(p_mission text)
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

    -- Verrouille le profil pour éviter deux récupérations simultanées.
    perform 1 from profiles where id = v_user for update;

    select * into v_eval from mission_eval(v_user, p_mission);

    foreach v_key in array v_eval.keys
    loop

        insert into mission_claims (user_id, mission, period_key, points)
        values (v_user, p_mission, v_key, v_points)
        on conflict do nothing;

        get diagnostics v_rows = row_count;

        v_total := v_total + v_rows * v_points;

    end loop;

    if v_total = 0 then
        raise exception 'Cette mission n''est pas accomplie ou a déjà été récupérée.';
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set points = points + v_total
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

    return v_total;

end;
$$;


-- ---------------------------------------------------------
-- 8. Acheter un avantage : l'achat est DÉFINITIF.
--    cadre : 250 pts. couleur : 100 pts.
--    Un avantage possédé ne se rachète pas.
-- ---------------------------------------------------------

create or replace function public.buy_reward(p_reward text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_price integer;
    v_points integer;
    v_profile record;
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

    select points, gold_frame_until, name_color_until into v_profile
    from profiles
    where id = v_user
    for update;

    if (p_reward = 'cadre' and v_profile.gold_frame_until > now())
        or (p_reward = 'couleur' and v_profile.name_color_until > now())
    then
        raise exception 'Tu possèdes déjà cet article.';
    end if;

    if v_profile.points < v_price then
        raise exception 'Il te manque % points.', v_price - v_profile.points;
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    if p_reward = 'cadre' then

        update profiles
        set points = points - v_price,
            gold_frame_until = '9999-12-31T00:00:00Z'
        where id = v_user;

    else

        update profiles
        set points = points - v_price,
            name_color_until = '9999-12-31T00:00:00Z'
        where id = v_user;

    end if;

    perform set_config('betlab.allow_points', 'off', true);

end;
$$;


-- Les avantages encore actifs deviennent définitifs.
select set_config('betlab.allow_points', 'on', false);

update public.profiles
set gold_frame_until = '9999-12-31T00:00:00Z'
where gold_frame_until > now();

update public.profiles
set name_color_until = '9999-12-31T00:00:00Z'
where name_color_until > now();

select set_config('betlab.allow_points', 'off', false);


-- ---------------------------------------------------------
-- 9. Droits d'appel
-- ---------------------------------------------------------

revoke execute on function public.mission_eval(uuid, text) from public, anon, authenticated;

grant execute on function public.mission_progress() to authenticated;
grant execute on function public.claim_mission(text) to authenticated;
grant execute on function public.buy_reward(text) to authenticated;
