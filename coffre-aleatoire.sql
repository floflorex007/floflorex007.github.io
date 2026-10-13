-- =========================================================
-- BetLab : coffre aléatoire à la place du coffre du jour (2026-10-13)
--
-- open_random_chest(p_group) : pour 100 🪙 (points du groupe), un article
-- permanent de la boutique au hasard, parmi ceux que le joueur n'a pas
-- encore. Plus l'article est cher, plus il est rare : chance
-- proportionnelle à 1 / prix. Option (emoji, couleur du néon, thème)
-- tirée au hasard elle aussi.
--
-- Catalogue : le même que buy_cosmetic (prix identiques), dans
-- shop_catalogue() ; mêmes chances côté site : CHEST_PRICE / chestOdds().
--
-- Le coffre du jour (open_daily_chest) n'est plus appelable.
--
-- 2026-10-13 : l'article gagné arrive non équipé, le site propose de
-- l'équiper.
-- =========================================================


create or replace function public.shop_catalogue()
returns table (item text, price integer, options text[])
language sql
immutable
as $$
    values
        ('emoji',             15,  array['🔥', '⚡', '🍀', '🦊', '💎', '🎯']),
        ('neon',              80,  array['rose', 'bleu', 'vert', 'jaune']),
        ('metal_rose',        100, null::text[]),
        ('metal_bronze',      150, null::text[]),
        ('metal_argent',      200, null::text[]),
        ('metal_or',          250, null::text[]),
        ('aura',              300, null::text[]),
        ('etincelles',        100, null::text[]),
        ('theme',             450, array['galaxie', 'carbone', 'sunset']),
        ('clic_perroquet',    30,  null::text[]),
        ('clic_perroquet_x3', 80,  null::text[]),
        ('scanner',           80,  null::text[]),
        ('neon_anime',        250, null::text[]),
        ('fiole',             280, null::text[]),
        ('ruban_chantier',    300, null::text[])
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
    v_member record;
    v_pick record;
    v_option text;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select points, cosmetics into v_member
    from group_members
    where group_id = p_group
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if coalesce(v_member.points, 0) < v_cost then
        raise exception 'Il te manque % 🪙 pour ouvrir le coffre.', v_cost - coalesce(v_member.points, 0);
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
        raise exception 'Tu as déjà tous les articles du coffre !';
    end if;

    if v_pick.options is not null then
        v_option := v_pick.options[1 + floor(random() * array_length(v_pick.options, 1))::integer];
    end if;

    -- L'article arrive non équipé (off) : le site demande si on veut l'équiper
    -- (toggle_cosmetic). Les clics du perroquet n'ont rien à équiper.
    update group_members
    set points = points - v_cost,
        cosmetics = cosmetics || jsonb_build_object(
            v_pick.item,
            jsonb_build_object('until', '9999-12-31T00:00:00Z', 'option', v_option)
            || case when v_pick.item like 'clic_perroquet%' then '{}'::jsonb else jsonb_build_object('off', true) end
        )
    where group_id = p_group
      and user_id = v_user;

    return jsonb_build_object(
        'item', v_pick.item,
        'option', v_option,
        'price', v_pick.price,
        'chance', round(v_pick.weight / v_pick.total * 100, 1)
    );

end;
$$;

grant execute on function public.open_random_chest(uuid) to authenticated;


-- Coffre du jour retiré : plus personne ne peut l'ouvrir.
revoke execute on function public.open_daily_chest(uuid) from public, anon, authenticated;
