-- =========================================================
-- BetLab : statut « Plus tard » pour les idées de l'Aide app (2026-10-16)
--
-- L'admin peut mettre une idée envoyée de côté (« Plus tard ») :
-- son auteur est prévenu, et l'idée peut encore être retenue
-- ou marquée « pas retenue » ensuite.
-- À lancer après aide-app.sql et beta-idees.sql.
-- =========================================================


alter table public.beta_ideas drop constraint if exists beta_ideas_status_check;

alter table public.beta_ideas add constraint beta_ideas_status_check
    check (status in ('sent', 'later', 'kept', 'rejected'));


-- Mettre une idée envoyée de côté.
create or replace function public.beta_later_idea(p_idea bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    update beta_ideas
    set status = 'later',
        decided_at = now(),
        seen_at = null
    where id = p_idea
      and status = 'sent';

    if not found then
        raise exception 'Idée introuvable ou déjà traitée.';
    end if;

end;
$$;

revoke all on function public.beta_later_idea(bigint) from public, anon;
grant execute on function public.beta_later_idea(bigint) to authenticated;


-- Retenir / refuser : possible aussi depuis « Plus tard » (même gains que beta-idees.sql).
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
      and status in ('sent', 'later')
    returning user_id, group_id into v_idea;

    if not found then
        raise exception 'Idée introuvable ou déjà traitée.';
    end if;

    if p_keep then
        -- Idée retenue : 80 pièces.
        perform public.beta_credit(v_idea.user_id, v_idea.group_id, 80);
    end if;

end;
$function$;


-- Supabase relit tout de suite les fonctions (sinon « schema cache »).
notify pgrst, 'reload schema';
