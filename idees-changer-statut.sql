-- =========================================================
-- BetLab : l'admin peut changer le statut d'une idée à tout moment (2026-10-16)
--
-- Retenue, Plus tard, Pas retenue : on passe de l'un à l'autre librement.
-- Les +80 pièces d'une idée retenue ne sont versées qu'une seule fois
-- (colonne kept_rewarded) : la retenir à nouveau ne paie pas deux fois,
-- et la passer ensuite en « Pas retenue » ne reprend pas les pièces.
-- L'auteur est prévenu à chaque changement (seen_at remis à null).
-- À lancer après idees-plus-tard.sql.
-- =========================================================


alter table public.beta_ideas
    add column if not exists kept_rewarded boolean not null default false;

-- Idées déjà retenues : leurs pièces ont déjà été versées.
update public.beta_ideas set kept_rewarded = true where status = 'kept';


create or replace function public.beta_set_idea_status(p_idea bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_idea record;
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    if p_status not in ('later', 'kept', 'rejected') then
        raise exception 'Statut inconnu.';
    end if;

    select user_id, group_id, status, kept_rewarded into v_idea
    from beta_ideas
    where id = p_idea
    for update;

    if not found then
        raise exception 'Idée introuvable.';
    end if;

    if v_idea.status = p_status then
        return;
    end if;

    update beta_ideas
    set status = p_status,
        decided_at = now(),
        seen_at = null,
        kept_rewarded = kept_rewarded or p_status = 'kept'
    where id = p_idea;

    if p_status = 'kept' and not v_idea.kept_rewarded then
        -- Idée retenue : 80 pièces, une seule fois.
        perform public.beta_credit(v_idea.user_id, v_idea.group_id, 80);
    end if;

end;
$$;

revoke all on function public.beta_set_idea_status(bigint, text) from public, anon;
grant execute on function public.beta_set_idea_status(bigint, text) to authenticated;


-- Supabase relit tout de suite les fonctions (sinon « schema cache »).
notify pgrst, 'reload schema';
