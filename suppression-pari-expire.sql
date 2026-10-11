-- =========================================================
-- BetLab : supprimer un pari publié resté sans parieur
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après
-- brouillon-createur.sql, combines.sql, cloture-courte.sql et saison.sql.
--
-- Conditions (même règle côté site : canDeleteExpiredBet dans app.js) :
--   - le pari est ouvert et ses mises sont closes (la carte est passée
--     en bloqué : 1 h, 15 min ou 5 min avant l'échéance, voir
--     bet_close_interval dans cloture-courte.sql) ;
--   - aucun autre joueur que le créateur n'a misé dessus
--     (ni mise simple, ni combiné) ;
--   - seul son créateur ou l'admin peut le supprimer.
--
-- La mise du créateur lui est remboursée sur le solde du groupe.
-- L'XP de saison gagnée avec ce pari (création, mise) est retirée,
-- pour qu'on ne puisse pas gagner d'XP gratuitement en boucle.
-- Choix, mises et le reste partent avec le pari (on delete cascade).
-- =========================================================


create or replace function public.delete_expired_bet(p_bet_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_refund numeric;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select id, author_id, group_id, status, created_at, deadline_at into v_bet
    from bets
    where id = p_bet_id
    for update;

    if not found then
        raise exception 'Pari introuvable (déjà supprimé ?).';
    end if;

    if v_bet.author_id is distinct from v_user
        and not exists (select 1 from profiles where id = v_user and is_admin)
    then
        raise exception 'Seul le créateur du pari peut le supprimer.';
    end if;

    if v_bet.status <> 'open' then
        raise exception 'Ce pari ne peut plus être supprimé.';
    end if;

    if v_bet.deadline_at is null
        or v_bet.deadline_at - bet_close_interval(v_bet.created_at, v_bet.deadline_at) > now()
    then
        raise exception 'Les mises ne sont pas encore closes.';
    end if;

    if exists (select 1 from stakes where bet_id = p_bet_id and user_id is distinct from v_bet.author_id)
        or exists (select 1 from combo_legs where bet_id = p_bet_id)
    then
        raise exception 'Quelqu''un a misé sur ce pari : il faut le valider.';
    end if;


    -- Remboursement de la mise du créateur.
    select coalesce(sum(stake), 0) into v_refund
    from stakes
    where bet_id = p_bet_id
      and user_id = v_bet.author_id;

    if v_refund > 0 then

        update group_members
        set balance = balance + v_refund
        where group_id = v_bet.group_id
          and user_id = v_bet.author_id;

    end if;


    -- XP de saison gagnée avec ce pari.
    delete from season_xp
    where user_id = v_bet.author_id
      and (
          (reason = 'creation' and ref = p_bet_id::text)
          or (reason = 'mise' and ref in (select id::text from stakes where bet_id = p_bet_id))
      );


    delete from bets where id = p_bet_id;

    return v_refund;

end;
$$;

grant execute on function public.delete_expired_bet(uuid) to authenticated;
