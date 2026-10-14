-- =========================================================
-- BetLab : skin Corbeau d'Halloween (2026-10-13)
--
-- Offert pour toujours à tout joueur qui se connecte entre le 25 et le
-- 31 octobre 2026 (heure de Paris). Retenu sur le compte :
--   - profiles.event_skins : skins gagnés pendant un événement ;
--   - set_parrot_skin accepte « corbeau » (en fin de script) ;
--   - claim_event_skins() : appelée à chaque connexion, donne le skin
--     pendant la semaine et dépose le message unique (player_notices),
--     renvoie les skins qui viennent d'être offerts.
-- =========================================================


alter table public.profiles
    add column if not exists event_skins text[] not null default '{}';


-- Version interne avec le jour en paramètre (pour pouvoir la tester).
create or replace function public.claim_event_skins_on(p_user uuid, p_day date)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_given text[] := '{}';
begin

    if p_day between date '2026-10-25' and date '2026-10-31'
       and not exists (
           select 1 from profiles
           where id = p_user
             and ('corbeau' = any(event_skins) or coalesce(is_admin, false))
       ) then

        update profiles
        set event_skins = array_append(event_skins, 'corbeau')
        where id = p_user;

        if found then

            insert into player_notices (user_id, title, content)
            values (
                p_user,
                '🎃 Halloween',
                'Pour la dernière semaine d''octobre, le skin Corbeau est à toi pour toujours ! Noir et orange, parfait pour Halloween.'
            );

            v_given := array['corbeau'];

        end if;

    end if;

    return v_given;

end;
$$;

revoke all on function public.claim_event_skins_on(uuid, date) from public, anon, authenticated;


create or replace function public.claim_event_skins()
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    return public.claim_event_skins_on(auth.uid(), (now() at time zone 'Europe/Paris')::date);

end;
$$;

grant execute on function public.claim_event_skins() to authenticated;


-- Le skin choisi est enregistré dans le profil (fenêtre d'un joueur) :
-- on ajoute « corbeau » à la liste des skins acceptés.
create or replace function public.set_parrot_skin(p_skin text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if p_skin not in ('classique', 'flamant', 'nuit', 'violet', 'arctique', 'noir', 'phenix', 'cristal', 'corbeau') then
        raise exception 'Skin inconnu.';
    end if;

    update profiles
    set parrot_skin = p_skin
    where id = auth.uid();

end;
$$;
