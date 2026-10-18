-- =========================================================
-- Identifiant oublié (page de connexion)
-- Sans compte, la table profiles n'est pas lisible (RLS) :
-- cette fonction renvoie seulement les pseudos qui commencent
-- par la lettre donnée (casse ignorée), rien d'autre.
-- =========================================================

create or replace function public.pseudos_par_lettre(p_lettre text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
    select username
    from profiles
    where length(trim(p_lettre)) = 1
      and lower(left(username, 1)) = lower(trim(p_lettre))
    order by lower(username);
$$;

grant execute on function public.pseudos_par_lettre(text) to anon, authenticated;
