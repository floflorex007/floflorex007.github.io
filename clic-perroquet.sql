-- =========================================================
-- BetLab : clic du perroquet
--
-- Article de boutique « Clic du perroquet » (30 points) : une fois
-- acheté, chaque clic sur le perroquet rapporte 1 €, jusqu'à 500 €
-- par jour et par groupe (jour de Paris).
--
-- À lancer après groupes-progression.sql.
-- =========================================================

alter table public.group_members
    add column if not exists parrot_clicks_day date,
    add column if not exists parrot_clicks integer not null default 0;


-- Catalogue de la boutique avec le nouvel article.
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
        ('titre',        20,  array['Chanceux', 'Outsider', 'Requin', 'Débutant']),
        ('metal_rose',   100, null::text[]),
        ('metal_bronze', 150, null::text[]),
        ('metal_argent', 200, null::text[]),
        ('metal_or',     250, null::text[]),
        ('aura',         300, null::text[]),
        ('etincelles',   100, null::text[]),
        ('theme',        450, array['galaxie', 'carbone', 'sunset']),
        ('clic_perroquet', 30, null::text[])
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


-- Crédite p_count clics (envoyés par paquets depuis le navigateur).
-- p_count = 0 : renvoie seulement l'état du jour.
create or replace function public.parrot_click(p_group uuid, p_count integer)
returns table(credited integer, today integer, balance numeric)
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

    select gm.balance, gm.cosmetics, gm.parrot_clicks_day, gm.parrot_clicks into v_member
    from group_members gm
    where gm.group_id = p_group
      and gm.user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    v_done := case when v_member.parrot_clicks_day = v_today then v_member.parrot_clicks else 0 end;

    credited := 0;

    if p_count > 0 then

        if coalesce((v_member.cosmetics -> 'clic_perroquet' ->> 'until')::timestamptz > now(), false) is false then
            raise exception 'Achète « Clic du perroquet » dans la boutique pour pouvoir cliquer.';
        end if;

        credited := least(p_count, 500 - v_done);

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
