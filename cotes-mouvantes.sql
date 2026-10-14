-- =========================================================
-- BetLab : cotes qui bougent (version B « moyenne » de
-- demo-cotes-mouvantes.html, 2026-10-14)
--
-- Le créateur fixe la cote de départ (bet_choices.start_odds),
-- puis chaque mise fait baisser la cote du choix misé et monter
-- les autres. Chacun garde la cote du moment où il a misé
-- (stakes.potential_win et combo_legs.odds, inchangés).
--
-- Calcul (recompute_bet_odds) : « pots » virtuels de 10 000 €
-- répartis selon les cotes de départ, + l'argent misé sur chaque
-- choix (mises simples + mise entière des combinés qui le contiennent).
-- Cote = total des pots ÷ pot du choix, entre 1,01 et 10.
--
-- Seulement pour les paris créés après ce script (bets.dynamic_odds) :
-- les paris déjà ouverts gardent leurs cotes fixes.
--
-- place_bet / place_combo prennent p_odds (cote affichée) : si la cote
-- a bougé entre-temps, la mise est refusée avec un message.
-- La mission « cote > 3 » regarde la cote prise par le joueur.
--
-- À lancer après cotes-et-combines.sql.
-- =========================================================


alter table public.bet_choices
    add column if not exists start_odds numeric;

update public.bet_choices set start_odds = odds where start_odds is null;

alter table public.bets
    add column if not exists dynamic_odds boolean not null default false;

-- Les nouveaux paris ont des cotes qui bougent, pas les anciens.
alter table public.bets
    alter column dynamic_odds set default true;


-- Cote de départ = cote fixée par le créateur.
create or replace function public.bet_choices_start_odds()
returns trigger
language plpgsql
as $$
begin
    new.start_odds := new.odds;
    return new;
end;
$$;

drop trigger if exists bet_choices_start_odds on public.bet_choices;

create trigger bet_choices_start_odds
    before insert on public.bet_choices
    for each row
    execute function public.bet_choices_start_odds();


create or replace function public.recompute_bet_odds(p_bet uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_liquidity constant numeric := 10000;
begin
    if not exists (select 1 from bets where id = p_bet and dynamic_odds) then
        return;
    end if;

    with c as (
        select bc.id,
               1 / bc.start_odds as inv,
               coalesce((select sum(s.stake) from stakes s where s.choice_id = bc.id), 0)
             + coalesce((select sum(co.stake) from combo_legs l join combos co on co.id = l.combo_id
                         where l.choice_id = bc.id), 0) as staked
        from bet_choices bc
        where bc.bet_id = p_bet
    ),
    pots as (
        select id, v_liquidity * inv / sum(inv) over () + staked as pot
        from c
    ),
    calc as (
        select id, least(10, greatest(1.01, round(sum(pot) over () / pot, 2))) as odds
        from pots
    )
    update bet_choices bc
    set odds = calc.odds
    from calc
    where bc.id = calc.id
      and bc.odds is distinct from calc.odds;
end;
$$;

revoke all on function public.recompute_bet_odds(uuid) from public, anon, authenticated;


create or replace function public.recompute_odds_after_stake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform recompute_bet_odds(new.bet_id);
    return null;
end;
$$;

drop trigger if exists stakes_recompute_odds on public.stakes;

create trigger stakes_recompute_odds
    after insert on public.stakes
    for each row
    execute function public.recompute_odds_after_stake();

drop trigger if exists combo_legs_recompute_odds on public.combo_legs;

create trigger combo_legs_recompute_odds
    after insert on public.combo_legs
    for each row
    execute function public.recompute_odds_after_stake();


-- ---------------------------------------------------------
-- Mises : cote affichée vérifiée (p_odds). Fonctions d'origine,
-- seul ce contrôle est ajouté.
-- ---------------------------------------------------------

drop function if exists public.place_bet(uuid, numeric);

CREATE OR REPLACE FUNCTION public.place_bet(p_choice_id uuid, p_stake numeric, p_odds numeric DEFAULT NULL::numeric)
 RETURNS stakes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_user_id uuid;
    v_balance numeric;
    v_bet_id uuid;
    v_group_id uuid;
    v_odds numeric;
    v_potential_win numeric;
    v_stake public.stakes;
    v_created_at timestamptz;
    v_deadline_at timestamptz;
    v_max numeric;
    v_author_id uuid;
    v_status text;
begin

    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Utilisateur non connecté';
    end if;


    if p_stake is null or p_stake <= 0 then
        raise exception 'La mise doit être supérieure à 0';
    end if;

    if p_stake <> trunc(p_stake) then
        raise exception 'La mise doit être un montant rond (sans centimes)';
    end if;

    if p_stake < 10 or p_stake > 5000 then
        raise exception 'La mise doit être comprise entre 10 € et 5 000 €';
    end if;


    select bc.bet_id, bc.odds, b.group_id, b.created_at, b.deadline_at, b.author_id, b.status
    into v_bet_id, v_odds, v_group_id, v_created_at, v_deadline_at, v_author_id, v_status
    from public.bet_choices bc
    join public.bets b
        on b.id = bc.bet_id
    where bc.id = p_choice_id
      and b.status in ('open', 'draft')
    for update of b;

    if v_bet_id is null then
        raise exception 'Ce pari n''est plus disponible';
    end if;

    -- Cotes qui bougent : la cote a pu changer depuis l'affichage.
    if p_odds is not null and abs(v_odds - p_odds) >= 0.005 then
        raise exception 'La cote a changé : % → %. Vérifie et mise à nouveau.',
            replace(to_char(p_odds, 'FM990.00'), '.', ','),
            replace(to_char(v_odds, 'FM990.00'), '.', ',');
    end if;

    -- Brouillon : seul son créateur peut miser (et sa mise le publie).
    if v_status = 'draft' then

        if v_author_id is distinct from v_user_id then
            raise exception 'Ce pari n''est plus disponible';
        end if;

        v_created_at := now();

    end if;


    if v_deadline_at is not null
       and now() >= v_deadline_at - public.bet_close_interval(v_created_at, v_deadline_at)
    then
        raise exception 'Les mises sont closes (échéance trop proche)';
    end if;


    -- Mise max du moment (10 s de marge pour le temps de trajet de la mise).
    v_max := public.bet_max_stake(v_created_at, v_deadline_at, now() - interval '10 seconds');

    if p_stake > v_max then
        raise exception 'Mise max en ce moment : % € (elle baisse avec le temps)', v_max;
    end if;


    select balance
    into v_balance
    from public.group_members
    where group_id = v_group_id
      and user_id = v_user_id
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe';
    end if;

    -- Le solde est verrouillé : deux mises simultanées ne peuvent pas dépasser la limite.
    if (select count(*) from public.stakes
        where bet_id = v_bet_id
          and user_id = v_user_id) >= 1
    then
        raise exception 'Tu as déjà misé sur ce pari (1 seule mise par pari)';
    end if;

    if v_balance < p_stake then
        raise exception 'Solde insuffisant';
    end if;


    v_potential_win := round(p_stake * v_odds, 2);


    update public.group_members
    set balance = balance - p_stake
    where group_id = v_group_id
      and user_id = v_user_id;


    insert into public.stakes (
        bet_id,
        choice_id,
        user_id,
        stake,
        potential_win
    )
    values (
        v_bet_id,
        p_choice_id,
        v_user_id,
        p_stake,
        v_potential_win
    )
    returning * into v_stake;


    -- Publication : le pari arrive chez tout le monde avec la mise du créateur.
    if v_status = 'draft' then

        update public.bets
        set status = 'open',
            created_at = v_created_at
        where id = v_bet_id;

    end if;

    return v_stake;

end;
$function$;

revoke all on function public.place_bet(uuid, numeric, numeric) from public, anon;
grant execute on function public.place_bet(uuid, numeric, numeric) to authenticated;


drop function if exists public.place_combo(uuid[], numeric);

CREATE OR REPLACE FUNCTION public.place_combo(p_choice_ids uuid[], p_stake numeric, p_odds numeric DEFAULT NULL::numeric)
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

    -- Cotes qui bougent : la cote du combiné a pu changer depuis l'affichage.
    if p_odds is not null and abs(v_odds - p_odds) >= 0.005 then
        raise exception 'La cote du combiné a changé : % → %. Vérifie et mise à nouveau.',
            replace(to_char(p_odds, 'FM9990.00'), '.', ','),
            replace(to_char(v_odds, 'FM9990.00'), '.', ',');
    end if;

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

revoke all on function public.place_combo(uuid[], numeric, numeric) from public, anon;
grant execute on function public.place_combo(uuid[], numeric, numeric) to authenticated;


-- ---------------------------------------------------------
-- Missions : « cote > 3 » = la cote prise par le joueur.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mission_eval(p_user uuid, p_group uuid, p_mission text, OUT progress numeric, OUT target numeric, OUT keys text[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_today date := (now() at time zone 'Europe/Paris')::date;
    v_week date := date_trunc('week', v_today)::date;
    v_day_start timestamptz := v_today::timestamp at time zone 'Europe/Paris';
    v_week_start timestamptz := v_week::timestamp at time zone 'Europe/Paris';
    v_day_key text := 'J' || v_today::text;
    v_week_key text := 'S' || v_week::text;
    v_reset timestamptz := coalesce(
        (select value from app_settings where key = 'missions_reset_at'),
        '-infinity'::timestamptz
    );
begin

    -- Rien avant la dernière réinitialisation ne compte.
    v_day_start := greatest(v_day_start, v_reset);
    v_week_start := greatest(v_week_start, v_reset);

    keys := '{}';

    if p_mission = 'connexion' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'touche' then

        target := 3;

        select count(distinct s.bet_id) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start;

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'premier' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_day_start
          and not exists (
              select 1 from stakes o
              where o.bet_id = s.bet_id
                and o.created_at < s.created_at
          );

        if progress >= target then keys := array[v_day_key]; end if;

    elsif p_mission = 'gros' then

        target := 700;

        select coalesce(sum(s.stake), 0) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and s.created_at >= v_week_start;

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'createur' then

        target := 5;

        -- Les mises du créateur sur son propre pari comptent aussi.
        select coalesce(max(n), 0) into progress
        from (
            select count(distinct s.user_id) as n
            from bets b
            join stakes s on s.bet_id = b.id
            where b.author_id = p_user
              and b.group_id = p_group
              and b.created_at >= v_week_start
            group by b.id
        ) t;

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'last_chance' then

        target := 1;

        -- Une mise placée pendant que la carte est rouge (entre 2 h et 1 h
        -- avant l'échéance), sur un pari gagné.
        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and b.status = 'resolved'
          and s.created_at >= v_week_start
          and b.winner_choice_id = s.choice_id
          and b.deadline_at is not null
          -- Carte rouge : 2 h avant pour un pari classique, dès la publication pour un pari court.
          and (public.bet_close_interval(b.created_at, b.deadline_at) < interval '1 hour'
               or s.created_at >= b.deadline_at - 2 * public.bet_close_interval(b.created_at, b.deadline_at))
          and s.created_at < b.deadline_at - public.bet_close_interval(b.created_at, b.deadline_at);

        if progress >= target then keys := array[v_week_key]; end if;

    elsif p_mission = 'premier_gain' then

        target := 1;

        select count(*) into progress
        from stakes s
        join bets b on b.id = s.bet_id
        where s.user_id = p_user
          and b.group_id = p_group
          and b.status = 'resolved'
          and s.created_at >= v_reset
          and b.winner_choice_id = s.choice_id;

        if progress >= target then keys := array['unique']; end if;

    elsif p_mission = 'outsider' then

        target := 1;

        keys := array(
            select distinct s.bet_id::text
            from stakes s
            join bets b on b.id = s.bet_id
            join bet_choices c on c.id = s.choice_id
            where s.user_id = p_user
              and b.group_id = p_group
              and b.status = 'resolved'
              and s.created_at >= v_reset
              and b.winner_choice_id = s.choice_id
              and s.potential_win / nullif(s.stake, 0) > 3
        );

        progress := cardinality(keys);

    elsif p_mission = 'contre' then

        target := 1;

        -- Le choix gagnant doit avoir strictement moins de mises
        -- que chacun des autres choix du pari.
        keys := array(
            select distinct s.bet_id::text
            from stakes s
            join bets b on b.id = s.bet_id
            where s.user_id = p_user
              and b.group_id = p_group
              and b.status = 'resolved'
              and s.created_at >= v_reset
              and b.winner_choice_id = s.choice_id
              and exists (
                  select 1 from bet_choices c2
                  where c2.bet_id = s.bet_id and c2.id <> s.choice_id
              )
              and (select count(*) from stakes x where x.choice_id = s.choice_id)
                  < all (
                      select count(x2.id)
                      from bet_choices c2
                      left join stakes x2 on x2.choice_id = c2.id
                      where c2.bet_id = s.bet_id
                        and c2.id <> s.choice_id
                      group by c2.id
                  )
        );

        progress := cardinality(keys);

    else

        raise exception 'Mission inconnue : %', p_mission;

    end if;

    progress := least(progress, target);

end;
$function$;
