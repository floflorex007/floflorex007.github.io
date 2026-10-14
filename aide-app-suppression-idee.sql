-- =========================================================
-- BetLab : l'admin supprime des idées dans l'onglet Aide app (2026-10-14)
--
-- L'idée disparaît pour tout le monde, avec ses votes (beta_idea_likes,
-- on delete cascade). Une nouveauté du journal liée à l'idée reste,
-- simplement sans lien (beta_news.idea_id remis à null).
-- Les pièces déjà gagnées par son auteur ne sont pas reprises.
-- =========================================================


create or replace function public.beta_delete_idea(p_idea bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if not public.beta_is_admin() then
        raise exception 'Réservé à l''admin.';
    end if;

    delete from beta_ideas where id = p_idea;

    if not found then
        raise exception 'Idée introuvable (déjà supprimée ?).';
    end if;

end;
$$;

revoke all on function public.beta_delete_idea(bigint) from public, anon;
grant execute on function public.beta_delete_idea(bigint) to authenticated;
