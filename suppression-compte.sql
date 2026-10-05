-- =========================================================
--   BETLAB : SUPPRESSION DE SON PROPRE COMPTE
--   À coller dans Supabase → SQL Editor → Run.
--   Le script peut être relancé sans risque.
--
--   Supprime le profil ET le compte de connexion (auth.users) :
--   l'identifiant ne pourra plus jamais se reconnecter.
--   Les paris créés par le joueur restent visibles
--   (sans créateur), ses mises sont supprimées.
-- =========================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if exists (select 1 from profiles where id = v_user and is_admin) then
        raise exception 'Le compte administrateur ne peut pas être supprimé depuis le site.';
    end if;

    -- Données propres au joueur.
    delete from stakes where user_id = v_user;
    delete from mission_claims where user_id = v_user;
    delete from message_reads where user_id = v_user;

    -- Références vers le joueur : on les détache.
    update bets set author_id = null where author_id = v_user;
    update bets set target_user_id = null, target_blocked = false where target_user_id = v_user;
    update admin_messages set created_by = null where created_by = v_user;

    -- Profil puis compte de connexion.
    delete from profiles where id = v_user;
    delete from auth.users where id = v_user;

end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
