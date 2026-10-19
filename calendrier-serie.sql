-- =========================================================
-- BetLab : calendrier des récompenses de série (fenêtre Flamme)
-- Maquette : Exemple-aide CLAUDE/demo-calendrier-serie.html
-- (chemin des paliers, retour au jour 1, bouton « Prendre »,
-- pièces + XP + boucliers, tout grossit chaque semaine, visibles à l'avance)
--
-- - Le jour du calendrier = la série (profiles.streak_days) : un jour raté
--   sans bouclier la remet à 1, le bouclier et le rattrapage la gardent.
-- - Semaine de 7 jours : 5 🪙, 10 🪙, 40 XP, 10 🪙, 1 bouclier, 15 🪙,
--   et le 7e jour la caisse (open_random_chest, gratuite ici).
--   (2026-10-19 : pièces baissées, au départ 10, 15, 20 et 25 🪙.)
--   Semaine 2 : ×1,5 ; semaine 3 : ×2 ; semaine 4 et plus : ×2,5
--   (pièces et XP ; le bouclier et la caisse restent les mêmes).
-- - Une récompense par jour, à prendre dans la fenêtre Flamme. Les pièces
--   vont dans le groupe où on la prend. Bouclier alors qu'on en a déjà 3 :
--   40 🪙 à la place ; caisse alors qu'on a tous les articles : 100 🪙.
-- - Récompense oubliée : donnée en plus la prochaine fois qu'on prend
--   celle du jour (la dernière oubliée seulement, 7 jours au plus).
--
-- À lancer après coffre-aleatoire.sql et rattrapage-serie.sql.
-- =========================================================


-- ---------- Récompense de chaque jour de série ----------

create or replace function public.streak_reward_of(p_day integer)
returns jsonb
language sql
immutable
as $$
    with w as (
        select (greatest(1, p_day) - 1) % 7 as dw,
               (array[1, 1.5, 2, 2.5])[least((greatest(1, p_day) - 1) / 7, 3) + 1] as mult
    )
    select case w.dw
        when 0 then jsonb_build_object('coins', (round(5 * w.mult / 5) * 5)::integer)
        when 1 then jsonb_build_object('coins', (round(10 * w.mult / 5) * 5)::integer)
        when 2 then jsonb_build_object('xp', (round(40 * w.mult / 5) * 5)::integer)
        when 3 then jsonb_build_object('coins', (round(10 * w.mult / 5) * 5)::integer)
        when 4 then jsonb_build_object('shields', 1)
        when 5 then jsonb_build_object('coins', (round(15 * w.mult / 5) * 5)::integer)
        else jsonb_build_object('chest', true)
    end
    from w;
$$;


-- ---------- Jours de connexion et récompenses prises ----------
-- Une ligne par joueur et par jour de connexion (claim_day, heure de Paris) :
-- streak_day = le jour de série ce jour-là ; claimed_at vide = pas encore prise.

create table if not exists public.streak_rewards (
    user_id uuid not null references auth.users(id) on delete cascade,
    claim_day date not null,
    streak_day integer not null check (streak_day >= 1),
    group_id uuid references public.groups(id) on delete set null,
    reward jsonb,
    claimed_at timestamptz,
    primary key (user_id, claim_day)
);

alter table public.streak_rewards enable row level security;

drop policy if exists "streak_rewards lecture" on public.streak_rewards;

create policy "streak_rewards lecture"
    on public.streak_rewards
    for select
    to authenticated
    using (user_id = auth.uid());


-- Connexion du jour (daily_checkin) ou série rattrapée (restore_streak) :
-- le jour est noté, avec la série de ce jour-là, tant qu'il n'est pas pris.
create or replace function public.streak_reward_on_checkin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

    if new.last_checkin is null then
        return new;
    end if;

    insert into streak_rewards (user_id, claim_day, streak_day)
    values (new.id, new.last_checkin, greatest(1, coalesce(new.streak_days, 1)))
    on conflict (user_id, claim_day) do update
        set streak_day = excluded.streak_day
        where streak_rewards.claimed_at is null;

    return new;

end;
$$;

drop trigger if exists streak_reward_on_checkin on public.profiles;

create trigger streak_reward_on_checkin
    after update of last_checkin, streak_days on public.profiles
    for each row
    when (new.last_checkin is distinct from old.last_checkin or new.streak_days is distinct from old.streak_days)
    execute function public.streak_reward_on_checkin();


-- ---------- La caisse : tirage partagé avec open_random_chest ----------
-- Un article permanent pas encore possédé, chance ∝ 1 / prix, option au hasard.
-- Renvoie null si le joueur a déjà tout.

create or replace function public.random_chest_draw(p_user uuid, p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_member record;
    v_pick record;
    v_option text;
begin

    select cosmetics into v_member
    from group_members
    where group_id = p_group
      and user_id = p_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    -- Tirage parmi les articles pas encore possédés, poids = 1 / prix.
    with pool as (
        select c.item, c.price, c.options,
               1.0 / c.price as weight,
               sum(1.0 / c.price) over (order by c.price, c.item) as upto,
               sum(1.0 / c.price) over () as total
        from shop_catalogue() c
        where not coalesce((v_member.cosmetics -> c.item ->> 'until')::timestamptz > now(), false)
    ),
    roll as (
        select random() * max(total) as value from pool
    )
    select pool.item, pool.price, pool.options, pool.weight, pool.total
    into v_pick
    from pool, roll
    where pool.upto >= roll.value
    order by pool.upto
    limit 1;

    if v_pick.item is null then
        return null;
    end if;

    if v_pick.options is not null then
        v_option := v_pick.options[1 + floor(random() * array_length(v_pick.options, 1))::integer];
    end if;

    -- L'article arrive non équipé (off) : le site demande si on veut l'équiper
    -- (toggle_cosmetic). Les clics du perroquet n'ont rien à équiper.
    update group_members
    set cosmetics = cosmetics || jsonb_build_object(
            v_pick.item,
            jsonb_build_object('until', '9999-12-31T00:00:00Z', 'option', v_option)
            || case when v_pick.item like 'clic_perroquet%' then '{}'::jsonb else jsonb_build_object('off', true) end
        )
    where group_id = p_group
      and user_id = p_user;

    return jsonb_build_object(
        'item', v_pick.item,
        'option', v_option,
        'price', v_pick.price,
        'chance', round(v_pick.weight / v_pick.total * 100, 1)
    );

end;
$$;

create or replace function public.open_random_chest(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_cost constant integer := 100;
    v_points integer;
    v_win jsonb;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select points into v_points
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if coalesce(v_points, 0) < v_cost then
        raise exception 'Il te manque % 🪙 pour ouvrir le coffre.', v_cost - coalesce(v_points, 0);
    end if;

    v_win := public.random_chest_draw(v_user, p_group);

    if v_win is null then
        raise exception 'Tu as déjà tous les articles du coffre !';
    end if;

    update group_members
    set points = points - v_cost
    where group_id = p_group
      and user_id = v_user;

    return v_win;

end;
$$;

revoke all on function public.random_chest_draw(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_random_chest(uuid) to authenticated;


-- ---------- Donner la récompense d'un jour (usage interne) ----------
-- Renvoie ce qui a vraiment été donné : coins, xp, shields, et pour la caisse
-- l'article gagné (item) ; shield_converted / chest_converted si remplacés par des pièces.

create or replace function public.streak_reward_give(p_user uuid, p_group uuid, p_day integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reward jsonb := public.streak_reward_of(p_day);
    v_coins integer := coalesce((v_reward ->> 'coins')::integer, 0);
    v_xp integer := coalesce((v_reward ->> 'xp')::integer, 0);
    v_shields integer := coalesce((v_reward ->> 'shields')::integer, 0);
    v_have integer;
    v_win jsonb;
begin

    if v_shields > 0 then

        select streak_shields into v_have from profiles where id = p_user;

        -- Déjà 3 boucliers (le maximum) : leur prix en pièces.
        if coalesce(v_have, 0) >= 3 then

            v_coins := v_coins + 40 * v_shields;

            v_shields := 0;

            v_reward := v_reward || jsonb_build_object('shield_converted', true);

        end if;

    end if;

    if coalesce((v_reward ->> 'chest')::boolean, false) then

        v_win := public.random_chest_draw(p_user, p_group);

        -- Tous les articles déjà gagnés : le prix de la caisse en pièces.
        if v_win is null then

            v_coins := v_coins + 100;

            v_reward := v_reward || jsonb_build_object('chest_converted', true);

        else

            v_reward := v_reward || jsonb_build_object('win', v_win);

        end if;

    end if;

    if v_coins > 0 then

        update group_members
        set points = points + v_coins
        where group_id = p_group
          and user_id = p_user;

    end if;

    if v_xp > 0 or v_shields > 0 then

        perform set_config('betlab.allow_points', 'on', true);

        update profiles
        set xp_bonus = coalesce(xp_bonus, 0) + v_xp,
            streak_shields = streak_shields + v_shields
        where id = p_user;

        perform set_config('betlab.allow_points', 'off', true);

    end if;

    return v_reward || jsonb_build_object('day', p_day, 'coins', v_coins, 'xp', v_xp, 'shields', v_shields);

end;
$$;

revoke all on function public.streak_reward_give(uuid, uuid, integer) from public, anon, authenticated;


-- ---------- Ce que montre la fenêtre Flamme ----------
-- day : jour de série ; checked_today : connexion du jour comptée ;
-- claimed_today : récompense du jour prise (reward = ce qui a été donné) ;
-- forgotten : récompense oubliée qui sera donnée avec celle du jour ;
-- days : 12 jours du chemin (2 avant aujourd'hui, 9 après) et leur récompense.

create or replace function public.streak_calendar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_profile record;
    v_day integer;
    v_from integer;
    v_claim record;
    v_forgot record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select streak_days, last_checkin into v_profile
    from profiles
    where id = v_user;

    v_day := greatest(1, coalesce(v_profile.streak_days, 1));

    v_from := greatest(1, v_day - 2);

    select reward, claimed_at into v_claim
    from streak_rewards
    where user_id = v_user
      and claim_day = v_today;

    select claim_day, streak_day into v_forgot
    from streak_rewards
    where user_id = v_user
      and claimed_at is null
      and claim_day < v_today
      and claim_day >= v_today - 7
    order by claim_day desc
    limit 1;

    return jsonb_build_object(
        'day', v_day,
        'checked_today', v_profile.last_checkin = v_today,
        'claimed_today', v_claim.claimed_at is not null,
        'reward', v_claim.reward,
        'forgotten', case
            when v_forgot.claim_day is null then null
            else jsonb_build_object('day', v_forgot.streak_day) || public.streak_reward_of(v_forgot.streak_day)
        end,
        'days', (
            select jsonb_agg(jsonb_build_object('day', d) || public.streak_reward_of(d) order by d)
            from generate_series(v_from, v_from + 11) as d
        )
    );

end;
$$;


-- ---------- Prendre la récompense du jour (bouton de la fenêtre Flamme) ----------

create or replace function public.claim_streak_reward(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_profile record;
    v_day integer;
    v_claimed timestamptz;
    v_reward jsonb;
    v_forgot record;
    v_forgot_reward jsonb;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    perform 1
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select streak_days, last_checkin into v_profile
    from profiles
    where id = v_user
    for update;

    if v_profile.last_checkin is distinct from v_today then
        raise exception 'Ta connexion du jour n''est pas encore comptée : recharge la page.';
    end if;

    select claimed_at into v_claimed
    from streak_rewards
    where user_id = v_user
      and claim_day = v_today
    for update;

    if v_claimed is not null then
        raise exception 'Récompense du jour déjà prise : reviens demain !';
    end if;

    v_day := greatest(1, coalesce(v_profile.streak_days, 1));

    v_reward := public.streak_reward_give(v_user, p_group, v_day);

    insert into streak_rewards (user_id, claim_day, streak_day, group_id, reward, claimed_at)
    values (v_user, v_today, v_day, p_group, v_reward, now())
    on conflict (user_id, claim_day) do update
        set streak_day = excluded.streak_day,
            group_id = excluded.group_id,
            reward = excluded.reward,
            claimed_at = excluded.claimed_at;

    -- Récompense oubliée (la dernière, 7 jours au plus) : donnée en plus.
    select claim_day, streak_day into v_forgot
    from streak_rewards
    where user_id = v_user
      and claimed_at is null
      and claim_day < v_today
      and claim_day >= v_today - 7
    order by claim_day desc
    limit 1;

    if v_forgot.claim_day is not null then

        v_forgot_reward := public.streak_reward_give(v_user, p_group, v_forgot.streak_day);

        update streak_rewards
        set group_id = p_group,
            reward = v_forgot_reward,
            claimed_at = now()
        where user_id = v_user
          and claim_day = v_forgot.claim_day;

    end if;

    -- Ménage : les autres oubliées sont perdues, l'historique gardé 90 jours.
    delete from streak_rewards
    where user_id = v_user
      and ((claimed_at is null and claim_day < v_today) or claim_day < v_today - 90);

    return jsonb_build_object('reward', v_reward, 'forgotten', v_forgot_reward);

end;
$$;

revoke all on function public.streak_calendar() from public, anon;
revoke all on function public.claim_streak_reward(uuid) from public, anon;
grant execute on function public.streak_calendar() to authenticated;
grant execute on function public.claim_streak_reward(uuid) to authenticated;
