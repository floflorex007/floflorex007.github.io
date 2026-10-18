-- =========================================================
-- BetLab : un seul défi à la fois entre deux joueurs
--
-- On ne peut pas défier quelqu'un tant qu'un défi entre vous deux
-- (envoyé ou reçu) attend une réponse ou est en cours.
--
-- Remplace duel_challenge (duels-pourcentage.sql). À lancer après lui.
-- =========================================================

create or replace function public.duel_challenge(p_group uuid, p_opponent uuid, p_choice uuid, p_pct integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_balance numeric;
    v_amount numeric;
    v_id uuid;
begin
    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_opponent = v_user then
        raise exception 'Tu ne peux pas te défier toi-même.';
    end if;

    if exists (select 1 from profiles where id in (v_user, p_opponent) and is_admin) then
        raise exception 'Les duels ne sont pas possibles avec le compte admin.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = p_opponent) then
        raise exception 'Ce joueur ne fait pas partie du groupe.';
    end if;

    if p_pct is null or p_pct < 1 or p_pct > 50 then
        raise exception 'Choisis un pourcentage de ton solde entre 1 et 50 %%.';
    end if;

    select b.* into v_bet
    from bet_choices c
    join bets b on b.id = c.bet_id
    where c.id = p_choice;

    if v_bet is null or v_bet.group_id <> p_group then
        raise exception 'Ce pari ne fait pas partie du groupe.';
    end if;

    if v_bet.status <> 'open' or (v_bet.deadline_at is not null and v_bet.deadline_at <= now()) then
        raise exception 'Ce pari n''est plus ouvert.';
    end if;

    if v_bet.author_id in (v_user, p_opponent) then
        raise exception 'Pas de duel sur un pari créé par l''un de vous deux.';
    end if;

    if v_bet.target_blocked and v_bet.target_user_id in (v_user, p_opponent) then
        raise exception 'Ce pari concerne l''un de vous deux : pas de duel dessus.';
    end if;

    -- Un seul défi à la fois entre deux joueurs (dans un sens ou dans l'autre) :
    -- il faut que le précédent soit terminé (refusé, expiré, réglé ou annulé).
    if exists (
        select 1 from duels
        where status in ('pending', 'active')
          and ((challenger = v_user and opponent = p_opponent) or (challenger = p_opponent and opponent = v_user))
    ) then
        raise exception 'Vous avez déjà un défi en cours tous les deux : attends qu''il soit terminé.';
    end if;

    select balance into v_balance
    from group_members
    where group_id = p_group and user_id = v_user
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    v_amount := duel_stake_of(v_balance, p_pct);

    if v_amount > v_balance then
        raise exception 'Solde insuffisant : il faut au moins 10 €.';
    end if;

    perform duel_pay(p_group, v_user, -v_amount);

    insert into duels (group_id, bet_id, challenger, opponent, challenger_choice, amount, challenger_pct, expires_at)
    values (p_group, v_bet.id, v_user, p_opponent, p_choice, v_amount, p_pct,
            least(now() + interval '24 hours', coalesce(v_bet.deadline_at, now() + interval '24 hours')))
    returning id into v_id;

    insert into player_notices (user_id, title, content)
    values (p_opponent, '⚔️ Tu es défié !',
            duel_name(v_user) || ' te défie sur « ' || v_bet.question || ' » en misant ' || p_pct
            || ' % de son solde. Réponds depuis la page Paris (24 h). Refuser coûte 1 % de ton solde.');

    return v_id;
end;
$$;
