-- =========================================================
-- BetLab : passe de combat réservé à l'admin (2026-10-14)
--
-- La version bêta (passe de combat, XP de saison, Gold) n'est plus
-- accessible qu'à l'admin (hasBetaVersionAccess dans app.js).
-- Les autres joueurs ne gagnent donc plus d'XP de saison en jouant
-- en version classique, et ne peuvent plus récupérer de récompense.
-- Ce qu'ils ont déjà gagné ou récupéré n'est pas repris.
-- =========================================================


CREATE OR REPLACE FUNCTION public.season_xp_add(p_user uuid, p_reason text, p_ref text, p_base integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_streak integer;
begin

    if p_user is null then
        return;
    end if;

    -- Passe de combat réservé à la version bêta, elle-même réservée à l'admin (2026-10-14).
    if not exists (select 1 from profiles where id = p_user and is_admin) then
        return;
    end if;

    select streak_days into v_streak from profiles where id = p_user;

    insert into season_xp (user_id, season, reason, ref, amount)
    values (p_user, current_season(), p_reason, p_ref, round(p_base * flame_mult(coalesce(v_streak, 0))))
    on conflict (user_id, reason, ref) do nothing;

end;
$function$;


CREATE OR REPLACE FUNCTION public.season_claim(p_group uuid, p_tier integer, p_track text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
    v_season text := current_season();
    v_xp integer;
    v_reward record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    -- Passe de combat réservé à la version bêta, elle-même réservée à l'admin (2026-10-14).
    if not exists (select 1 from profiles where id = v_user and is_admin) then
        raise exception 'Le passe de combat est réservé à la version bêta.';
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
$function$;
