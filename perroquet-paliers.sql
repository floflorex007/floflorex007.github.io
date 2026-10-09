-- =========================================================
-- BetLab : clic du perroquet pour tous, paliers et boosts
--
-- - Le clic du perroquet est débloqué pour tout le monde : 1 € par clic.
-- - Boutique : « Clic du perroquet ×2 » (ancien article clic_perroquet,
--   30 points : ceux qui l'avaient passent en ×2) et « Clic du perroquet ×3 »
--   (clic_perroquet_x3, 80 points).
-- - Plafond par jour selon le meilleur solde atteint dans le groupe
--   (version A de demo-popup-solde.html) :
--   départ 500 €/j, 5 000 € → 750, 10 000 € → 1 000, 25 000 € → 1 500,
--   50 000 € → 2 500, 100 000 € → 5 000.
--
-- À lancer après clic-perroquet.sql et aide-app.sql.
-- =========================================================


-- Meilleur solde atteint dans chaque groupe (il ne redescend jamais).
alter table public.group_members
    add column if not exists best_balance numeric not null default 0;

update public.group_members
set best_balance = greatest(best_balance, balance);

create or replace function public.track_best_balance()
returns trigger
language plpgsql
as $$
begin

    new.best_balance := greatest(
        coalesce(new.best_balance, 0),
        coalesce(old.best_balance, 0),
        coalesce(new.balance, 0)
    );

    return new;

end;
$$;

drop trigger if exists track_best_balance on public.group_members;

create trigger track_best_balance
    before insert or update on public.group_members
    for each row execute function public.track_best_balance();


-- Plafond par jour selon le palier atteint.
create or replace function public.parrot_click_cap(p_best numeric)
returns integer
language sql
immutable
as $$
    select case
        when p_best >= 100000 then 5000
        when p_best >= 50000 then 2500
        when p_best >= 25000 then 1500
        when p_best >= 10000 then 1000
        when p_best >= 5000 then 750
        else 500
    end;
$$;


-- Clics du perroquet : p_count clics, chacun rapporte 1, 2 ou 3 €,
-- jusqu'au plafond du jour. p_count = 0 donne juste l'état du jour.
drop function if exists public.parrot_click(uuid, integer);

create or replace function public.parrot_click(p_group uuid, p_count integer)
returns table (credited integer, today integer, balance numeric, cap integer, mult integer, best numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_member record;
    v_done integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_count is null or p_count < 0 or p_count > 40 then
        raise exception 'Nombre de clics invalide.';
    end if;

    select gm.balance, gm.best_balance, gm.cosmetics, gm.parrot_clicks_day, gm.parrot_clicks into v_member
    from group_members gm
    where gm.group_id = p_group
      and gm.user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    -- Boost acheté en boutique : le plus fort compte.
    mult := case
        when coalesce((v_member.cosmetics -> 'clic_perroquet_x3' ->> 'until')::timestamptz > now(), false) then 3
        when coalesce((v_member.cosmetics -> 'clic_perroquet' ->> 'until')::timestamptz > now(), false) then 2
        else 1
    end;

    best := greatest(v_member.best_balance, v_member.balance);

    cap := public.parrot_click_cap(best);

    -- Euros déjà récupérés aujourd'hui dans ce groupe.
    v_done := case when v_member.parrot_clicks_day = v_today then v_member.parrot_clicks else 0 end;

    credited := 0;

    if p_count > 0 then

        credited := greatest(0, least(p_count * mult, cap - v_done));

        if credited > 0 then

            update group_members gm
            set balance = gm.balance + credited,
                parrot_clicks_day = v_today,
                parrot_clicks = v_done + credited
            where gm.group_id = p_group
              and gm.user_id = v_user;

            v_done := v_done + credited;

        end if;

    end if;

    today := v_done;

    select gm.balance into balance
    from group_members gm
    where gm.group_id = p_group
      and gm.user_id = v_user;

    return next;

end;
$$;


-- Boutique : nouvel article « Clic du perroquet ×3 ».
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
