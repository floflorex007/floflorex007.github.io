-- =========================================================
-- BetLab : les diamants 💎
--
-- Monnaie commune à tous les groupes (profiles.diamonds).
-- - Objets exclusifs, achetés une fois pour tous les groupes
--   (profiles.diamond_items) : pseudo cristal 1 💎, cadre diamant 8 💎,
--   💎 à côté du pseudo 2 💎, thème de carte « Diamant » 5 💎,
--   skin perroquet « Cristal » 10 💎.
-- - Échange à sens unique : 1 💎 = 200 🪙 (points du groupe choisi).
-- - Pas encore d'achat en ligne : l'admin donne les diamants
--   (page admin, « Stats des joueurs »).
--
-- À lancer après admin-stats.sql.
-- =========================================================


alter table public.profiles
    add column if not exists diamonds integer not null default 0,
    add column if not exists diamond_items jsonb not null default '{}'::jsonb;


-- Les joueurs ne modifient ni leurs diamants ni leurs objets eux-mêmes.
create or replace function public.protect_profile_diamonds()
returns trigger
language plpgsql
as $$
begin

    if coalesce(current_setting('betlab.allow_points', true), '') <> 'on'
        and (
            new.diamonds is distinct from old.diamonds
            or new.diamond_items is distinct from old.diamond_items
        )
    then
        raise exception 'Les diamants ne peuvent pas être modifiés directement.';
    end if;

    return new;

end;
$$;

drop trigger if exists protect_profile_diamonds on public.profiles;

create trigger protect_profile_diamonds
    before update on public.profiles
    for each row execute function public.protect_profile_diamonds();


-- Acheter un objet exclusif.
create or replace function public.buy_diamond_item(p_item text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_price integer;
    v_profile record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select price into v_price
    from (values
        ('cristal', 1),
        ('cadre_diamant', 8),
        ('emoji_diamant', 2),
        ('theme_diamant', 5),
        ('skin_cristal', 10)
    ) as catalogue(item, price)
    where item = p_item;

    if v_price is null then
        raise exception 'Objet inconnu.';
    end if;

    select diamonds, diamond_items, is_admin into v_profile
    from profiles
    where id = v_user
    for update;

    if v_profile.diamond_items ? p_item then
        raise exception 'Tu possèdes déjà cet objet.';
    end if;

    -- L'admin a des diamants illimités.
    if not v_profile.is_admin and v_profile.diamonds < v_price then
        raise exception 'Il te manque % 💎.', v_price - v_profile.diamonds;
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set diamonds = case when is_admin then diamonds else diamonds - v_price end,
        diamond_items = diamond_items || jsonb_build_object(p_item, jsonb_build_object('off', false))
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

    return (select diamonds from profiles where id = v_user);

end;
$$;


-- Équiper / retirer un objet exclusif possédé.
create or replace function public.toggle_diamond_item(p_item text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    if not exists (select 1 from profiles where id = v_user and diamond_items ? p_item) then
        raise exception 'Tu ne possèdes pas cet objet.';
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set diamond_items = jsonb_set(diamond_items, array[p_item, 'off'], to_jsonb(not p_on))
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

end;
$$;


-- Échanger des diamants contre des points (1 💎 = 200 🪙, dans le groupe choisi).
create or replace function public.convert_diamonds(p_group uuid, p_count integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_diamonds integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_count is null or p_count < 1 then
        raise exception 'Choisis au moins 1 💎.';
    end if;

    select diamonds into v_diamonds
    from profiles
    where id = v_user
    for update;

    if v_diamonds < p_count then
        raise exception 'Tu n''as que % 💎.', v_diamonds;
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set diamonds = diamonds - p_count
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

    update group_members
    set points = points + p_count * 200
    where group_id = p_group
      and user_id = v_user;

    return p_count * 200;

end;
$$;


-- Admin : les stats affichent aussi les diamants, et l'admin peut les modifier.
drop function if exists public.admin_list_stats();

create or replace function public.admin_list_stats()
returns table (
    group_id uuid,
    group_name text,
    user_id uuid,
    username text,
    balance numeric,
    points integer,
    streak_days integer,
    xp integer,
    diamonds integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    return query
        select g.id, g.name, p.id, p.username, gm.balance, gm.points::integer,
               coalesce(p.streak_days, 0), public.player_xp_of(p.id), p.diamonds
        from group_members gm
        join groups g on g.id = gm.group_id
        join profiles p on p.id = gm.user_id
        where not p.is_admin
        order by g.name, p.username;

end;
$$;


create or replace function public.admin_set_diamonds(p_user uuid, p_diamonds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''administrateur.';
    end if;

    if p_diamonds is null or p_diamonds < 0 then
        raise exception 'Le nombre de diamants doit être positif.';
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set diamonds = p_diamonds
    where id = p_user;

    perform set_config('betlab.allow_points', 'off', true);

end;
$$;
