-- =========================================================
-- BetLab : un pari n'est validable qu'après la mise d'un autre joueur
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après
-- commission-createur.sql.
--
-- Le créateur mise obligatoirement sur son pari pour le publier
-- (brouillon-createur.sql). Pour qu'il ne puisse pas miser puis
-- valider aussitôt le bon choix, resolve_bet refuse tant
-- qu'aucun autre joueur n'a misé. Vaut aussi pour l'admin.
--
-- resolve_bet est reprise telle qu'elle est en base (2026-10-08,
-- version de commission-createur.sql) : seul ce refus est ajouté.
-- Même règle côté site : hasOtherStake() dans app.js.
-- =========================================================


create or replace function public.resolve_bet(p_bet_id uuid, p_winner_choice_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_lost numeric;
    v_commission numeric;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select * into v_bet
    from bets
    where id = p_bet_id
    for update;

    if v_bet is null then
        raise exception 'Pari introuvable.';
    end if;

    if v_bet.author_id is distinct from v_user
        and not exists (select 1 from profiles where id = v_user and is_admin)
    then
        raise exception 'Seul le créateur du pari peut le valider.';
    end if;

    if v_bet.status = 'resolved' then
        raise exception 'Ce pari a déjà été validé.';
    end if;

    if v_bet.status = 'cancelled' then
        raise exception 'Ce pari a été annulé après contestation.';
    end if;

    -- Il faut qu'un autre joueur que le créateur ait misé :
    -- sinon le créateur pourrait miser puis valider tout de suite.
    if not exists (
        select 1 from stakes
        where bet_id = p_bet_id
          and user_id <> v_bet.author_id
    ) then
        raise exception 'Pas encore validable : il faut qu''un autre joueur ait misé sur ce pari.';
    end if;

    if not exists (
        select 1 from bet_choices
        where id = p_winner_choice_id
          and bet_id = p_bet_id
    ) then
        raise exception 'Ce choix ne fait pas partie du pari.';
    end if;

    update bets
    set status = 'resolved',
        winner_choice_id = p_winner_choice_id
    where id = p_bet_id;


    -- Commission du créateur : 10 % des mises perdues
    -- (ses propres mises éventuelles ne comptent pas).
    select coalesce(sum(stake), 0) into v_lost
    from stakes
    where bet_id = p_bet_id
      and choice_id <> p_winner_choice_id
      and user_id <> v_bet.author_id;

    v_commission := round(v_lost * 0.10);

    if v_commission > 0 then

        insert into bet_commissions (bet_id, group_id, user_id, amount)
        values (p_bet_id, v_bet.group_id, v_bet.author_id, v_commission)
        on conflict (bet_id) do nothing;

    end if;

end;
$$;
