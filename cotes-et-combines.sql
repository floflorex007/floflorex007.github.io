-- =========================================================
-- BetLab : équilibrage des cotes et des combinés (2026-10-14)
--
-- Constat : des combinés à cote 100 avec ~4 650 € de mise
-- (jusqu'à 474 000 € de gain), et des cotes de 10+ qui gagnent
-- 1 fois sur 3 entre collègues.
--
--   1. Cote d'un choix : entre 1,01 et 10 (avant : 20 côté site
--      seulement, rien dans la base). Seulement pour les nouveaux
--      choix ou une cote modifiée : les paris existants ne bougent pas.
--   2. Mise d'un combiné : 2 500 € maximum (avant : 5 000 €).
--      Les paris simples restent à 5 000 €.
--   3. Cote d'un combiné = produit des cotes + boost (+5 % par pari
--      au-delà de 2, inchangé), plafonnée à 30 (avant : 100), sans marge.
--      Gain max d'un combiné : 2 500 € × 30 = 75 000 €.
--      Un combiné gagné paie la cote de SON ticket (combos.odds) :
--      les combinés déjà pris à cote 100 gardent leur gain promis.
--
-- Côté site : ODDS_MAX = 10, cote enflammée dès 8 (ODDS_FIRE_FROM),
-- COMBO_STAKE_MAX = 2500, COMBO_MAX_ODDS = 30 dans app.js.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Cote max 10
-- ---------------------------------------------------------

create or replace function public.bet_choices_odds_limit()
returns trigger
language plpgsql
as $$
begin

    if new.odds is null or new.odds < 1.01 or new.odds > 10 then
        raise exception 'La cote doit être comprise entre 1,01 et 10.';
    end if;

    return new;

end;
$$;

drop trigger if exists bet_choices_odds_limit on public.bet_choices;

create trigger bet_choices_odds_limit
    before insert or update of odds on public.bet_choices
    for each row
    execute function public.bet_choices_odds_limit();


-- ---------------------------------------------------------
-- 2. Combiné : mise max 2 500 € (place_combo d'origine, seule
--    la vérification de la mise change)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_combo(p_choice_ids uuid[], p_stake numeric)
 RETURNS combos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user uuid := auth.uid();
    v_group uuid;
    v_count integer;
    v_leg record;
    v_product numeric := 1;
    v_max numeric := 5000;
    v_odds numeric;
    v_balance numeric;
    v_combo combos;
    v_created timestamptz;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté';
    end if;

    if p_stake is null or p_stake <> trunc(p_stake) then
        raise exception 'La mise doit être un montant rond (sans centimes)';
    end if;

    -- Combiné : 2 500 € maximum (cotes-et-combines.sql, 2026-10-14).
    if p_stake < 10 or p_stake > 2500 then
        raise exception 'La mise d''un combiné doit être comprise entre 10 € et 2 500 €';
    end if;

    v_count := coalesce(array_length(p_choice_ids, 1), 0);

    if v_count < 2 or v_count > 4 then
        raise exception 'Un combiné regroupe de 2 à 4 paris';
    end if;

    if (select count(distinct bc.bet_id) from bet_choices bc where bc.id = any (p_choice_ids)) <> v_count then
        raise exception 'Un seul choix par pari dans un combiné';
    end if;


    for v_leg in
        select bc.id as choice_id, bc.odds, b.*
        from bet_choices bc
        join bets b on b.id = bc.bet_id
        where bc.id = any (p_choice_ids)
        for update of b
    loop

        -- Brouillon : seulement le sien, et le combiné le publie (il démarre maintenant).
        if v_leg.status = 'draft' and v_leg.author_id = v_user then
            v_created := now();
        elsif v_leg.status = 'open' then
            v_created := v_leg.created_at;
        else
            raise exception 'Le pari « % » n''est plus ouvert', v_leg.question;
        end if;

        if v_group is null then
            v_group := v_leg.group_id;
        elsif v_group <> v_leg.group_id then
            raise exception 'Tous les paris d''un combiné doivent être du même groupe';
        end if;

        if v_leg.deadline_at is not null
           and now() >= v_leg.deadline_at - bet_close_interval(v_created, v_leg.deadline_at)
        then
            raise exception 'Les mises sont closes sur « % »', v_leg.question;
        end if;

        if v_leg.target_user_id = v_user and v_leg.target_blocked then
            raise exception 'Tu es concerné(e) par « % », tu ne peux pas parier dessus', v_leg.question;
        end if;

        v_product := v_product * v_leg.odds;

        v_max := least(v_max, bet_max_stake(v_created, v_leg.deadline_at, now() - interval '10 seconds'));

    end loop;

    if p_stake > v_max then
        raise exception 'Mise max en ce moment pour ce combiné : % € (elle baisse avec le temps)', v_max;
    end if;


    select balance into v_balance
    from group_members
    where group_id = v_group
      and user_id = v_user
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe';
    end if;

    if v_balance < p_stake then
        raise exception 'Solde insuffisant';
    end if;

    -- Pas deux fois le même combiné (mêmes choix). Vérifié après le verrou
    -- du solde : deux envois simultanés ne passent pas tous les deux.
    if exists (
        select 1 from combos c
        where c.user_id = v_user
          and c.group_id = v_group
          and (select array_agg(l.choice_id order by l.choice_id) from combo_legs l where l.combo_id = c.id)
              = (select array_agg(x order by x) from unnest(p_choice_ids) x)
    ) then
        raise exception 'Tu as déjà fait ce combiné (mêmes paris, mêmes choix).';
    end if;


    v_odds := combo_odds(v_product, v_count);

    update group_members
    set balance = balance - p_stake
    where group_id = v_group
      and user_id = v_user;

    insert into combos (user_id, group_id, stake, odds, potential_win)
    values (v_user, v_group, p_stake, v_odds, round(p_stake * v_odds, 2))
    returning * into v_combo;

    insert into combo_legs (combo_id, bet_id, choice_id, odds)
    select v_combo.id, bc.bet_id, bc.id, bc.odds
    from bet_choices bc
    where bc.id = any (p_choice_ids);

    -- Publication des brouillons du combiné : ils arrivent chez tout le monde.
    update bets
    set status = 'open',
        created_at = now()
    where status = 'draft'
      and author_id = v_user
      and id in (select bc.bet_id from bet_choices bc where bc.id = any (p_choice_ids));

    return v_combo;

end;
$function$;


-- ---------------------------------------------------------
-- 3. Cote d'un combiné : boost inchangé, plafond 30
-- ---------------------------------------------------------

create or replace function public.combo_odds(p_product numeric, p_legs integer)
returns numeric
language sql
immutable
as $$
    select round(least(30, p_product * (1 + 0.05 * greatest(p_legs - 2, 0))), 2);
$$;


-- Gagné : on paie la cote du ticket (fixée à la mise), pas un recalcul
-- avec le plafond d'aujourd'hui. Le reste est inchangé.
create or replace function public.combo_state(p_combo uuid)
returns table(status text, payout numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
    v_stake numeric;
    v_odds numeric;
    v_lost integer;
    v_pending integer;
    v_won integer;
    v_product numeric;
begin

    select stake, odds into v_stake, v_odds from combos where id = p_combo;

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
        return query select 'won'::text, round(v_stake * coalesce(v_odds, combo_odds(v_product, v_won)), 2);
    end if;

end;
$$;
