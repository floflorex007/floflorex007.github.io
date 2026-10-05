-- ---------------------------------------------------------
-- 5. Équiper / retirer un article possédé
--    Retiré = cosmetics.<article>.off = true
--    (l'article reste possédé, il n'est juste plus affiché).
--    Marche aussi pour « cadre » et « couleur » (missions.sql).
-- ---------------------------------------------------------

create or replace function public.toggle_cosmetic(p_item text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_profile record;
    v_owned boolean;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select gold_frame_until, name_color_until, cosmetics into v_profile
    from profiles
    where id = v_user
    for update;

    v_owned := case p_item
        when 'cadre' then v_profile.gold_frame_until > now()
        when 'couleur' then v_profile.name_color_until > now()
        else (v_profile.cosmetics -> p_item ->> 'until')::timestamptz > now()
    end;

    if not coalesce(v_owned, false) then
        raise exception 'Tu ne possèdes pas cet article.';
    end if;

    perform set_config('betlab.allow_points', 'on', true);

    update profiles
    set cosmetics = cosmetics || jsonb_build_object(
        p_item,
        coalesce(cosmetics -> p_item, '{}'::jsonb) || jsonb_build_object('off', not p_on)
    )
    where id = v_user;

    perform set_config('betlab.allow_points', 'off', true);

end;
$$;

grant execute on function public.toggle_cosmetic(text, boolean) to authenticated;
