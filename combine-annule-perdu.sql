-- =====================================================
-- COMBINÉ PERDU SI UN DE SES PARIS EST ANNULÉ (2026-10-12)
-- =====================================================
--
-- Avant : un pari annulé après contestation sortait du combiné (cote 1).
-- Maintenant : un pari annulé fait perdre tout le combiné.
--
-- combo_state : un pari « cancelled » compte comme perdu.
-- settle_contest : un combiné déjà récupéré qui devient perdu voit son
-- gain entièrement repris (claimed_amount passe à 0, il reste soldé).
--
-- Les combinés déjà récupérés AVANT ce script ne sont pas corrigés ici.


CREATE OR REPLACE FUNCTION public.combo_state(p_combo uuid)
 RETURNS TABLE(status text, payout numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_stake numeric;
    v_lost integer;
    v_pending integer;
    v_won integer;
    v_product numeric;
begin

    select stake into v_stake from combos where id = p_combo;

    -- Pari annulé (contestation) = combiné perdu.
    select
        count(*) filter (where b.status = 'cancelled'
                            or (b.status = 'resolved' and b.winner_choice_id is distinct from l.choice_id)),
        count(*) filter (where b.status not in ('resolved', 'cancelled')),
        count(*) filter (where b.status = 'resolved' and b.winner_choice_id = l.choice_id),
        coalesce(exp(sum(ln(l.odds)) filter (where b.status = 'resolved' and b.winner_choice_id = l.choice_id)), 1)
    into v_lost, v_pending, v_won, v_product
    from combo_legs l
    join bets b on b.id = l.bet_id
    where l.combo_id = p_combo;

    if v_lost > 0 then
        return query select 'lost'::text, 0::numeric;
    elsif v_pending > 0 then
        return query select 'open'::text, 0::numeric;
    elsif v_won = 0 then
        return query select 'refunded'::text, v_stake;
    else
        return query select 'won'::text, round(v_stake * combo_odds(v_product, v_won), 2);
    end if;

end;
$function$;


CREATE OR REPLACE FUNCTION public.settle_contest(p_bet_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_contest record;
    v_bet record;
    v_jury integer;
    v_yes integer;
    v_no integer;
    v_total numeric;
    v_penalty numeric;
    v_annul boolean;
    v_commission numeric;
    v_combo record;
    v_state record;
begin

    select * into v_contest
    from bet_contests
    where bet_id = p_bet_id
    for update;

    if v_contest is null then
        return null;
    end if;

    if v_contest.status <> 'open' then
        return v_contest.status;
    end if;

    select count(*) into v_jury from contest_jury(p_bet_id);

    select
        count(*) filter (where v.annul),
        count(*) filter (where not v.annul)
    into v_yes, v_no
    from bet_contest_votes v
    where v.bet_id = p_bet_id
      and v.user_id in (select j.user_id from contest_jury(p_bet_id) j);

    if v_jury > 0 and v_yes * 2 > v_jury then
        v_annul := true;                       -- majorité du jury pour annuler
    elsif v_jury > 0 and v_no * 2 >= v_jury then
        v_annul := false;                      -- l'annulation ne peut plus l'emporter
    elsif now() >= v_contest.ends_at then
        v_annul := v_yes > v_no;               -- 24 h écoulées : majorité des votes
    else
        return 'open';
    end if;


    if not v_annul then

        update bet_contests
        set status = 'upheld',
            settled_at = now(),
            jury_size = v_jury,
            votes_annul = v_yes,
            votes_keep = v_no
        where bet_id = p_bet_id;

        return 'upheld';

    end if;


    select * into v_bet
    from bets
    where id = p_bet_id
    for update;

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

    -- Amende du créateur : 10 % du total misé sur le pari.
    select coalesce(sum(stake), 0) into v_total
    from stakes
    where bet_id = p_bet_id;

    v_penalty := round(v_total * 0.10);

    if v_penalty > 0 then
        update group_members
        set balance = balance - v_penalty
        where group_id = v_bet.group_id
          and user_id = v_bet.author_id;
    end if;

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

    -- Combinés déjà récupérés qui contiennent ce pari : un pari annulé rend
    -- le combiné perdu, le gain déjà récupéré est donc repris en entier.
    -- (Les combinés pas encore récupérés se recalculent tout seuls.)
    for v_combo in
        select c.*
        from combos c
        join combo_legs l on l.combo_id = c.id
        where l.bet_id = p_bet_id
          and c.claimed_at is not null
        for update of c
    loop

        select * into v_state from combo_state(v_combo.id);

        if v_state.status in ('won', 'refunded', 'lost')
           and v_state.payout <> coalesce(v_combo.claimed_amount, 0)
        then

            update group_members
            set balance = balance + (v_state.payout - coalesce(v_combo.claimed_amount, 0))
            where group_id = v_combo.group_id
              and user_id = v_combo.user_id;

            update combos
            set claimed_amount = v_state.payout
            where id = v_combo.id;

        elsif v_state.status = 'open' then

            update group_members
            set balance = balance - coalesce(v_combo.claimed_amount, 0)
            where group_id = v_combo.group_id
              and user_id = v_combo.user_id;

            update combos
            set claimed_at = null,
                claimed_amount = null
            where id = v_combo.id;

        end if;

    end loop;

    update bet_contests
    set status = 'annulled',
        settled_at = now(),
        jury_size = v_jury,
        votes_annul = v_yes,
        votes_keep = v_no,
        penalty = v_penalty
    where bet_id = p_bet_id;

    return 'annulled';

end;
$function$;
