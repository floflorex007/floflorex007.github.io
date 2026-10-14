-- =========================================================
-- BetLab : arbre du groupe, effets du palier 1
--
-- 🤪 WTF : 1 boost gratuit par semaine pour chaque membre.
--   Il s'active au moment de miser (pari simple ou combiné) :
--   si la mise gagne, le gain est augmenté de 20 %.
--   Il revient chaque lundi 0 h (heure de Paris) ; pas de stock.
--   Le gain affiché (potential_win) inclut déjà le boost.
--
-- 🎯 Try hard : +50 % d'XP le lundi.
--   XP des mises placées le lundi, et bonus « pari gagné »
--   des paris résolus le lundi (heure de Paris).
--
-- Les deux effets comptent à partir du moment où la case a été
-- choisie, et seulement si l'arbre est allumé dans le groupe.
--
-- À lancer après arbre-groupe.sql et cotes-mouvantes.sql.
-- =========================================================


alter table public.stakes
    add column if not exists boosted boolean not null default false;

alter table public.combos
    add column if not exists boosted boolean not null default false;


-- Date du choix d'une case dans un groupe (null si pas choisie ou arbre éteint).
create or replace function public.tree_node_since(p_group uuid, p_node text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
    select c.chosen_at
    from group_tree_choices c
    join groups g on g.id = c.group_id
    where c.group_id = p_group
      and c.node = p_node
      and g.tree_enabled;
$$;


-- Le joueur a-t-il encore son boost de la semaine dans ce groupe ?
create or replace function public.boost_available(p_group uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.tree_node_since(p_group, 'w') is not null
       and not exists (
           select 1
           from stakes s
           join bets b on b.id = s.bet_id
           where b.group_id = p_group
             and s.user_id = p_user
             and s.boosted
             and s.created_at >= public.chat_week_start()
       )
       and not exists (
           select 1
           from combos c
           where c.group_id = p_group
             and c.user_id = p_user
             and c.boosted
             and c.created_at >= public.chat_week_start()
       );
$$;


-- Pour le ticket : le groupe a-t-il le boost, et le joueur l'a-t-il encore ?
create or replace function public.my_boost(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'wtf', public.tree_node_since(p_group, 'w') is not null,
        'available', public.boost_available(p_group, auth.uid())
    );
$$;


/* ---------- Mise simple : p_boost ---------- */

drop function if exists public.place_bet(uuid, numeric, numeric);

create or replace function public.place_bet(
    p_choice_id uuid,
    p_stake numeric,
    p_odds numeric default null,
    p_boost boolean default false
)
returns public.stakes
language plpgsql
security definer
set search_path = public
as $$
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

    -- Boost WTF : vérifié après le verrou du solde (un seul boost par semaine).
    if p_boost and not public.boost_available(v_group_id, v_user_id) then
        raise exception 'Tu n''as plus de boost cette semaine : le prochain arrive lundi.';
    end if;


    v_potential_win := round(p_stake * v_odds * (case when p_boost then 1.2 else 1 end), 2);


    update public.group_members
    set balance = balance - p_stake
    where group_id = v_group_id
      and user_id = v_user_id;


    insert into public.stakes (
        bet_id,
        choice_id,
        user_id,
        stake,
        potential_win,
        boosted
    )
    values (
        v_bet_id,
        p_choice_id,
        v_user_id,
        p_stake,
        v_potential_win,
        coalesce(p_boost, false)
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
$$;


/* ---------- Combiné : p_boost ---------- */

drop function if exists public.place_combo(uuid[], numeric, numeric);

create or replace function public.place_combo(
    p_choice_ids uuid[],
    p_stake numeric,
    p_odds numeric default null,
    p_boost boolean default false
)
returns public.combos
language plpgsql
security definer
set search_path = public
as $$
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

    -- Boost WTF : vérifié après le verrou du solde (un seul boost par semaine).
    if p_boost and not public.boost_available(v_group, v_user) then
        raise exception 'Tu n''as plus de boost cette semaine : le prochain arrive lundi.';
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

    insert into combos (user_id, group_id, stake, odds, potential_win, boosted)
    values (v_user, v_group, p_stake, v_odds,
            round(p_stake * v_odds * (case when p_boost then 1.2 else 1 end), 2),
            coalesce(p_boost, false))
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
$$;


-- Gain d'un combiné gagné : +20 % s'il a été boosté (un combiné remboursé rend la mise).
create or replace function public.combo_state(p_combo uuid)
returns table (status text, payout numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_stake numeric;
    v_odds numeric;
    v_boosted boolean;
    v_lost integer;
    v_pending integer;
    v_won integer;
    v_product numeric;
begin

    select stake, odds, boosted into v_stake, v_odds, v_boosted from combos where id = p_combo;

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
        return query select 'won'::text,
            round(v_stake * coalesce(v_odds, combo_odds(v_product, v_won))
                  * (case when v_boosted then 1.2 else 1 end), 2);
    end if;

end;
$$;


revoke all on function public.place_bet(uuid, numeric, numeric, boolean) from public, anon;
grant execute on function public.place_bet(uuid, numeric, numeric, boolean) to authenticated;

revoke all on function public.place_combo(uuid[], numeric, numeric, boolean) from public, anon;
grant execute on function public.place_combo(uuid[], numeric, numeric, boolean) to authenticated;

revoke all on function public.boost_available(uuid, uuid) from public, anon, authenticated;
grant execute on function public.my_boost(uuid) to authenticated;


/* ---------- Cote prise = gain / mise, sans le boost ----------
   Mission « cote supérieure à 3 » et fiche d'un joueur : un boost ne doit
   pas faire passer une cote de 2,60 pour 3,12. On corrige les deux fonctions
   en place (même texte, avec le boost retiré du calcul). */

do $$
declare
    v_fn text;
    v_def text;
begin
    foreach v_fn in array array['mission_eval', 'player_profile'] loop

        select pg_get_functiondef(p.oid) into v_def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_fn;

        if v_def is null or position('s.potential_win / nullif(s.stake, 0)' in v_def) = 0 then
            raise exception 'Fonction % : calcul de la cote introuvable', v_fn;
        end if;

        if position('then 1.2 else 1' in v_def) = 0 then
            execute replace(
                v_def,
                's.potential_win / nullif(s.stake, 0)',
                '(s.potential_win / nullif(s.stake, 0) / (case when s.boosted then 1.2 else 1 end))'
            );
        end if;

    end loop;
end;
$$;


/* ---------- 🎯 Try hard : +50 % d'XP le lundi ---------- */

create or replace function public.player_xp_of(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    with reset as (
        select coalesce(
            (select value from app_settings where key = 'xp_reset_at'),
            '-infinity'::timestamptz
        ) as at
    )
    select greatest(0, round(
        (select coalesce(sum(stake_xp(stake)), 0)
         from stakes, reset
         where user_id = p_user
           and created_at >= reset.at)
        + (select count(*) * 25
           from stakes s
           join bets b on b.id = s.bet_id
           cross join reset
           where s.user_id = p_user
             and s.created_at >= reset.at
             and b.status = 'resolved'
             and b.winner_choice_id = s.choice_id)
        -- Try hard : la moitié en plus pour les mises du lundi et les paris gagnés résolus un lundi.
        + (select coalesce(sum(
               case when extract(isodow from s.created_at at time zone 'Europe/Paris') = 1
                    then stake_xp(s.stake) * 0.5 else 0 end
             + case when b.status = 'resolved'
                     and b.winner_choice_id = s.choice_id
                     and extract(isodow from b.resolved_at at time zone 'Europe/Paris') = 1
                    then 25 * 0.5 else 0 end
           ), 0)
           from stakes s
           join bets b on b.id = s.bet_id
           cross join reset
           where s.user_id = p_user
             and s.created_at >= reset.at
             and s.created_at >= public.tree_node_since(b.group_id, 't'))
        + coalesce((select xp_bonus from profiles where id = p_user), 0)
    ))::integer;
$$;
