-- =========================================================
-- Pseudo disponible ? (question 1 de l'inscription)
-- Sans compte, la table profiles n'est pas lisible (RLS) :
-- cette fonction répond seulement vrai / faux, sans rien
-- montrer d'autre. Même pseudo à la casse près = pris.
-- =========================================================

create or replace function public.pseudo_disponible(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select not exists (
        select 1
        from profiles
        where lower(username) = lower(trim(p_username))
    );
$$;

grant execute on function public.pseudo_disponible(text) to anon, authenticated;
