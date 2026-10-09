-- =========================================================
-- BetLab : pseudo enflammé (récompense de série)
--
-- À 15 jours de série, le pseudo s'écrit en braises (version D de
-- demo-pseudo-enflamme.html), seulement tant que la série tient.
-- Le joueur peut le désactiver depuis la fenêtre de la série.
--
-- À lancer après serie-protection.sql.
-- =========================================================

alter table public.profiles
    add column if not exists flame_name_off boolean not null default false;


-- Activer / désactiver son pseudo enflammé (visible par tous).
create or replace function public.toggle_flame_name(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    update profiles
    set flame_name_off = not p_on
    where id = auth.uid();

end;
$$;
