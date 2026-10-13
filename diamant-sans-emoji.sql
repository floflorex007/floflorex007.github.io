-- =========================================================
-- BetLab : boutique des diamants (2026-10-13)
--   - article « 💎 à côté du pseudo » (emoji_diamant) retiré ;
--   - Cadre diamant : 8 → 2 💎.
-- buy_diamond_item reprise telle qu'elle est en base, seules ces lignes changent.
-- Même prix côté site : DIAMOND_ITEMS dans app.js.
-- =========================================================


CREATE OR REPLACE FUNCTION public.buy_diamond_item(p_item text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        ('cadre_diamant', 2),
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
$function$;
