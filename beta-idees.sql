-- =========================================================
-- BetLab : onglet Aide app, idées (2026-10-12)
--
-- À lancer après aide-app.sql.
--   - idées : 10 par jour (avant : 5 envois, bugs et idées confondus) ;
--     les bugs gardent leur limite de 5 par jour, comptée à part ;
--   - idée proposée : 5 pièces (avant : 10) ;
--   - idée retenue : 80 pièces (avant : 150).
-- Fonctions reprises telles qu'elles sont en base, seuls ces points changent.
-- Même valeurs côté site : BETA_POINTS dans app.js.
-- =========================================================


CREATE OR REPLACE FUNCTION public.beta_check_sender(p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if not exists (select 1 from beta_testers where user_id = v_user and status = 'accepted') then
        raise exception 'Réservé aux bêta-testeurs.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = v_user) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

end;
$function$;


CREATE OR REPLACE FUNCTION public.beta_send_bug(p_group uuid, p_topic text, p_text text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
begin

    perform public.beta_check_sender(p_group);

    -- 5 bugs par jour au plus (les idées ont leur propre limite).
    if (select count(*) from beta_bugs where user_id = v_user and created_at > now() - interval '1 day') >= 5 then
        raise exception 'Tu as déjà signalé 5 bugs aujourd''hui : reviens demain !';
    end if;

    if p_topic not in (
        'Paris : créer / valider',
        'Mise : Simple / Combinée',
        'Profil : XP, flammes, argent, pièces',
        'Affichage / téléphone',
        'Autre'
    ) then
        raise exception 'Choisis où tu as vu le problème.';
    end if;

    if char_length(trim(coalesce(p_text, ''))) < 5 then
        raise exception 'Explique un peu plus ce qui s''est passé.';
    end if;

    insert into beta_bugs (user_id, group_id, topic, text)
    values (v_user, p_group, p_topic, left(trim(p_text), 600));

    update beta_testers set contributions = contributions + 1 where user_id = v_user;

    perform public.beta_credit(v_user, p_group, 10);

    return 10;

end;
$function$;


CREATE OR REPLACE FUNCTION public.beta_send_idea(p_group uuid, p_kind text, p_text text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
begin

    perform public.beta_check_sender(p_group);

    -- 10 idées par jour au plus (avant : 5 envois, bugs et idées confondus).
    if (select count(*) from beta_ideas where user_id = v_user and created_at > now() - interval '1 day') >= 10 then
        raise exception 'Tu as déjà proposé 10 idées aujourd''hui : reviens demain !';
    end if;

    if p_kind not in ('feature', 'design') then
        raise exception 'Choisis Fonctionnalité ou Design.';
    end if;

    if char_length(trim(coalesce(p_text, ''))) < 5 then
        raise exception 'Décris ton idée en quelques mots.';
    end if;

    insert into beta_ideas (user_id, group_id, kind, text)
    values (v_user, p_group, p_kind, left(trim(p_text), 300));

    update beta_testers set contributions = contributions + 1 where user_id = v_user;

    -- Idée proposée : 5 pièces (avant : 10).
    perform public.beta_credit(v_user, p_group, 5);

    return 5;

end;
$function$;


CREATE OR REPLACE FUNCTION public.beta_decide_idea(p_idea bigint, p_keep boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_idea record;
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    update beta_ideas
    set status = case when p_keep then 'kept' else 'rejected' end,
        decided_at = now(),
        seen_at = null
    where id = p_idea
      and status = 'sent'
    returning user_id, group_id into v_idea;

    if not found then
        raise exception 'Idée introuvable ou déjà traitée.';
    end if;

    if p_keep then
        -- Idée retenue : 80 pièces (avant : 150).
        perform public.beta_credit(v_idea.user_id, v_idea.group_id, 80);
    end if;

end;
$function$;
