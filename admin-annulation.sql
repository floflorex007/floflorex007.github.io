-- =========================================================
-- BetLab : l'admin peut annuler n'importe quel pari (2026-10-12)
--
-- À lancer après combine-annule-perdu.sql et
-- correction-combines-annules.sql (table player_notices).
--
-- admin_cancel_bet(p_bet_id) : même annulation qu'une contestation
-- gagnée (settle_contest), sans amende pour le créateur :
--   - chacun retrouve sa mise (gain déjà récupéré repris) ;
--   - commission du créateur reprise ou annulée ;
--   - bets.status = 'cancelled' ;
--   - combinés qui contiennent le pari : perdus (combine-annule-perdu.sql),
--     gain déjà récupéré repris ;
--   - contestation en cours : close comme « annulée » ;
--   - chaque joueur concerné reçoit un message (player_notices).
--
-- La validation par l'admin existe déjà : resolve_bet accepte l'admin.
-- =========================================================


create or replace function public.admin_cancel_bet(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_commission numeric;
    v_combo record;
    v_state record;
    v_player record;
    v_commission_any boolean;
    v_author_told boolean := false;
begin

    if v_user is null
        or not exists (select 1 from profiles where id = v_user and is_admin)
    then
        raise exception 'Seul l''admin peut annuler un pari.';
    end if;

    select * into v_bet
    from bets
    where id = p_bet_id
    for update;

    if v_bet is null then
        raise exception 'Pari introuvable.';
    end if;

    if v_bet.status = 'cancelled' then
        raise exception 'Ce pari est déjà annulé.';
    end if;


    v_commission_any := exists (
        select 1 from bet_commissions
        where bet_id = p_bet_id and reversed_at is null and amount > 0
    );

    -- Message pour chaque joueur concerné, créateur compris
    -- (calculé avant les changements).
    for v_player in
        select
            d.user_id,
            sum(d.refund) as refund,
            sum(d.taken) as taken,
            sum(d.combo_stake) as combo_stake
        from (
            select s.user_id,
                   s.stake - case
                       when s.claimed_at is not null and s.choice_id = v_bet.winner_choice_id
                       then s.potential_win else 0
                   end as refund,
                   0::numeric as taken,
                   0::numeric as combo_stake
            from stakes s
            where s.bet_id = p_bet_id
            union all
            select c.user_id, 0, coalesce(c.claimed_amount, 0), c.stake
            from combos c
            join combo_legs l on l.combo_id = c.id
            where l.bet_id = p_bet_id
              and (select status from combo_state(c.id)) <> 'lost'
        ) d
        where d.user_id <> v_user
        group by d.user_id
    loop

        insert into player_notices (user_id, title, content)
        values (
            v_player.user_id,
            '🚫 Pari annulé par l''admin',
            case when v_player.user_id = v_bet.author_id
                 then 'L''admin a annulé ton pari « ' || v_bet.question || ' ».'
                      || case when v_commission_any then ' Ta commission sur ce pari est annulée.' else '' end
                 else 'L''admin a annulé le pari « ' || v_bet.question || ' ».' end
            || case when v_player.refund > 0
                    then ' Ta mise t''a été rendue (+' || public.format_euros(v_player.refund) || ').'
                    when v_player.refund < 0
                    then ' Le gain que tu avais récupéré a été repris, ta mise rendue (' || public.format_euros(v_player.refund) || ').'
                    else '' end
            || case when v_player.combo_stake > 0
                    then ' Un pari annulé fait perdre le combiné : ton combiné qui le contenait est perdu'
                         || case when v_player.taken > 0
                                 then ' et son gain (' || public.format_euros(v_player.taken) || ') a été repris.'
                                 else '.' end
                    else '' end
        );

        v_author_told := v_author_told or v_player.user_id = v_bet.author_id;

    end loop;

    -- Créateur sans mise sur son pari : il est quand même prévenu.
    if not v_author_told and v_bet.author_id is distinct from v_user and v_bet.author_id is not null then

        insert into player_notices (user_id, title, content)
        values (
            v_bet.author_id,
            '🚫 Pari annulé par l''admin',
            'L''admin a annulé ton pari « ' || v_bet.question || ' ». Les mises ont été rendues aux joueurs.'
            || case when v_commission_any then ' Ta commission sur ce pari est annulée.' else '' end
        );

    end if;


    -- Chacun retrouve sa mise : gain déjà récupéré repris, mise perdue rendue.
    update group_members gm
    set balance = gm.balance + d.delta
    from (
        select s.user_id,
               sum(s.stake - case
                   when s.claimed_at is not null and s.choice_id = v_bet.winner_choice_id
                   then s.potential_win
                   else 0
               end) as delta
        from stakes s
        where s.bet_id = p_bet_id
        group by s.user_id
    ) d
    where gm.group_id = v_bet.group_id
      and gm.user_id = d.user_id;

    update stakes
    set claimed_at = coalesce(claimed_at, now())
    where bet_id = p_bet_id;

    -- Commission du créateur : reprise si déjà récupérée, sinon annulée.
    select amount into v_commission
    from bet_commissions
    where bet_id = p_bet_id
      and reversed_at is null
      and claimed_at is not null;

    if coalesce(v_commission, 0) > 0 then

        update group_members
        set balance = balance - v_commission
        where group_id = v_bet.group_id
          and user_id = v_bet.author_id;

    end if;

    update bet_commissions
    set reversed_at = now()
    where bet_id = p_bet_id
      and reversed_at is null;

    update bets
    set status = 'cancelled'
    where id = p_bet_id;

    -- Combinés déjà récupérés qui contiennent ce pari : perdus, gain repris.
    for v_combo in
        select c.*
        from combos c
        join combo_legs l on l.combo_id = c.id
        where l.bet_id = p_bet_id
          and c.claimed_at is not null
          and coalesce(c.claimed_amount, 0) > 0
        for update of c
    loop

        update group_members
        set balance = balance - v_combo.claimed_amount
        where group_id = v_combo.group_id
          and user_id = v_combo.user_id;

        update combos
        set claimed_amount = 0
        where id = v_combo.id;

    end loop;

    -- Contestation en cours : l'admin a tranché, elle est close.
    update bet_contests
    set status = 'annulled',
        settled_at = now(),
        penalty = 0
    where bet_id = p_bet_id
      and status = 'open';

end;
$$;

grant execute on function public.admin_cancel_bet(uuid) to authenticated;


-- Montant lisible dans les messages : 169 117,48 € / 2 681 €.
create or replace function public.format_euros(p_amount numeric)
returns text
language sql
immutable
as $$
    select case when p_amount < 0 then '−' else '' end
        || regexp_replace(
               replace(replace(to_char(abs(p_amount), 'FM999,999,990.00'), ',', ' '), '.', ','),
               ',00$', ''
           ) || ' €';
$$;


-- resolve_bet reprise telle qu'elle est en base (2026-10-12) :
-- seul le message au créateur, quand l'admin valide, est ajouté.

CREATE OR REPLACE FUNCTION public.resolve_bet(p_bet_id uuid, p_winner_choice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Il faut qu'un autre joueur que le créateur ait misé (seul ou en combiné) :
    -- sinon le créateur pourrait miser puis valider tout de suite.
    if not exists (
        select 1 from stakes
        where bet_id = p_bet_id
          and user_id <> v_bet.author_id
    ) and not exists (
        select 1 from combo_legs l
        join combos c on c.id = l.combo_id
        where l.bet_id = p_bet_id
          and c.user_id <> v_bet.author_id
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
    -- (ses propres mises éventuelles ne comptent pas, ni les combinés).
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


    -- Validé par l'admin à la place du créateur : le créateur est prévenu.
    if v_user is distinct from v_bet.author_id and v_bet.author_id is not null then

        insert into player_notices (user_id, title, content)
        select
            v_bet.author_id,
            '✓ Pari validé par l''admin',
            'L''admin a validé ton pari « ' || v_bet.question || ' » : « ' || label || ' » gagne.'
        from bet_choices
        where id = p_winner_choice_id;

    end if;

end;
$function$;
