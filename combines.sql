-- =========================================================
-- BetLab : paris combinés
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après
-- brouillon-createur.sql et validation-autre-joueur.sql.
--
-- Règles (choisies le 2026-10-08) :
--   - 2 à 4 paris ouverts du même groupe, un seul choix par pari ;
--   - les cotes se multiplient, boost de +5 % par pari au-delà
--     de 2, cote totale plafonnée à 100 ;
--   - mise ronde de 10 € à 5 000 €, et au plus la plus petite
--     mise max du moment parmi les paris choisis ;
--   - un combiné ne compte pas dans « 1 mise par pari », et
--     ses propres paris sont autorisés ; mais on ne peut pas refaire
--     un combiné identique (mêmes paris, mêmes choix) ;
--   - tout ou rien : perdu dès qu'un pari est perdu ; un pari
--     annulé après contestation sort du combiné (cote 1) ;
--   - un brouillon de son propre pari peut entrer dans un combiné :
--     le combiné le publie (comme une mise simple, voir brouillon-createur.sql) ;
--   - le gain se récupère (claim_combo), bloqué pendant une
--     contestation ; un combiné perdu se solde aussi par un clic
--     (« Perdre la mise »), comme une mise simple ; si une validation est annulée après coup,
--     un gain déjà récupéré est recalculé (la différence est reprise) ;
--   - pas de commission du créateur sur les combinés ;
--   - une mise en combiné compte comme « un autre joueur a misé »
--     pour pouvoir valider un pari ; elle permet aussi de contester,
--     et écarte du jury.
--
-- Reprend telles qu'elles sont en base (2026-10-08) : resolve_bet
-- (validation-autre-joueur.sql), open_contest, contest_jury et
-- settle_contest (commission-createur.sql), group_contests ; seul ce qui concerne
-- les combinés change.
-- Même calcul côté site : comboState() dans app.js.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------

create table if not exists public.combos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    group_id uuid not null references public.groups (id) on delete cascade,
    stake numeric not null,
    odds numeric not null,               -- cote totale au moment de la mise, boost compris
    potential_win numeric not null,
    created_at timestamptz not null default now(),
    claimed_at timestamptz,
    claimed_amount numeric
);

create table if not exists public.combo_legs (
    combo_id uuid not null references public.combos (id) on delete cascade,
    bet_id uuid not null references public.bets (id) on delete cascade,
    choice_id uuid not null references public.bet_choices (id) on delete cascade,
    odds numeric not null,               -- cote du choix au moment de la mise
    primary key (combo_id, bet_id)
);

create index if not exists combo_legs_bet_idx on public.combo_legs (bet_id);

create index if not exists combos_user_idx on public.combos (user_id, group_id);

alter table public.combos enable row level security;

alter table public.combo_legs enable row level security;

-- Lecture : les membres du groupe (comme les mises). Écriture : par les fonctions seulement.
drop policy if exists combos_select_group on public.combos;

create policy combos_select_group on public.combos
    for select
    using (is_group_member(group_id));

drop policy if exists combo_legs_select_group on public.combo_legs;

create policy combo_legs_select_group on public.combo_legs
    for select
    using (exists (
        select 1 from public.combos c
        where c.id = combo_legs.combo_id
          and is_group_member(c.group_id)
    ));


-- ---------------------------------------------------------
-- 2. Cote d'un combiné : boost et plafond
-- ---------------------------------------------------------

create or replace function public.combo_odds(p_product numeric, p_legs integer)
returns numeric
language sql
immutable
as $$
    select round(least(100, p_product * (1 + 0.05 * greatest(p_legs - 2, 0))), 2);
$$;


-- ---------------------------------------------------------
-- 3. État d'un combiné
--    open (en attente), lost, won, refunded (tous annulés)
-- ---------------------------------------------------------

create or replace function public.combo_state(p_combo uuid)
returns table (status text, payout numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
    v_stake numeric;
    v_lost integer;
    v_pending integer;
    v_won integer;
    v_product numeric;
begin

    select stake into v_stake from combos where id = p_combo;

    select
        count(*) filter (where b.status = 'resolved' and b.winner_choice_id is distinct from l.choice_id),
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
$$;


-- ---------------------------------------------------------
-- 4. Placer un combiné
-- ---------------------------------------------------------

create or replace function public.place_combo(p_choice_ids uuid[], p_stake numeric)
returns combos
language plpgsql
security definer
set search_path to 'public'
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

    if p_stake < 10 or p_stake > 5000 then
        raise exception 'La mise doit être comprise entre 10 € et 5 000 €';
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
$$;

grant execute on function public.place_combo(uuid[], numeric) to authenticated;


-- ---------------------------------------------------------
-- 5. Récupérer le gain d'un combiné
-- ---------------------------------------------------------

create or replace function public.claim_combo(p_combo uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_combo combos;
    v_leg record;
    v_state record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select * into v_combo
    from combos
    where id = p_combo
    for update;

    if v_combo is null or v_combo.user_id <> v_user then
        raise exception 'Combiné introuvable.';
    end if;

    if v_combo.claimed_at is not null then
        raise exception 'Ce combiné a déjà été récupéré.';
    end if;

    -- Un vote arrivé à son terme se termine ; un vote en cours bloque le gain.
    for v_leg in
        select bet_id from combo_legs where combo_id = p_combo
    loop
        if public.settle_contest(v_leg.bet_id) = 'open' then
            raise exception 'Contestation en cours sur un des paris : le gain est bloqué jusqu''à la fin du vote.';
        end if;
    end loop;

    select * into v_state from combo_state(p_combo);

    if v_state.status = 'open' then
        raise exception 'Ce combiné n''est pas encore terminé.';
    end if;

    -- Combiné perdu : rien à ajouter au solde (la mise est déjà partie), il est soldé.

    perform 1 from group_members
    where group_id = v_combo.group_id
      and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais plus partie de ce groupe.';
    end if;

    update combos
    set claimed_at = now(),
        claimed_amount = v_state.payout
    where id = p_combo;

    if v_state.payout > 0 then
        update group_members
        set balance = balance + v_state.payout
        where group_id = v_combo.group_id
          and user_id = v_user;
    end if;

    return v_state.payout;

end;
$$;

grant execute on function public.claim_combo(uuid) to authenticated;


-- ---------------------------------------------------------
-- 6. resolve_bet : une mise en combiné compte comme
--    « un autre joueur a misé »
-- ---------------------------------------------------------

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

end;
$$;


-- ---------------------------------------------------------
-- 7. Contestations : un joueur en combiné peut contester,
--    et ne fait pas partie du jury
-- ---------------------------------------------------------

create or replace function public.open_contest(p_bet_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select * into v_bet
    from bets
    where id = p_bet_id
    for update;

    if v_bet is null or v_bet.status <> 'resolved' then
        raise exception 'On ne peut contester qu''un pari validé.';
    end if;

    if v_bet.author_id = v_user then
        raise exception 'Tu ne peux pas contester ton propre pari.';
    end if;

    if v_bet.resolved_at is null or now() > v_bet.resolved_at + interval '24 hours' then
        raise exception 'Trop tard : on peut contester pendant 24 h après la validation.';
    end if;

    if not exists (
        select 1 from stakes
        where bet_id = p_bet_id
          and user_id = v_user
    ) and not exists (
        select 1 from combo_legs l
        join combos c on c.id = l.combo_id
        where l.bet_id = p_bet_id
          and c.user_id = v_user
    ) then
        raise exception 'Seuls les joueurs qui ont misé sur ce pari peuvent le contester.';
    end if;

    if exists (select 1 from bet_contests where bet_id = p_bet_id) then
        raise exception 'Ce pari a déjà été contesté.';
    end if;

    insert into bet_contests (bet_id, group_id, opened_by, reason, ends_at)
    values (
        p_bet_id,
        v_bet.group_id,
        v_user,
        nullif(left(trim(coalesce(p_reason, '')), 200), ''),
        now() + interval '24 hours'
    );

end;
$$;


create or replace function public.contest_jury(p_bet_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
    with b as (
        select group_id, author_id from bets where id = p_bet_id
    ),
    members as (
        select gm.user_id
        from group_members gm
        join b on gm.group_id = b.group_id
        join profiles p on p.id = gm.user_id
        where gm.user_id <> b.author_id
          and not coalesce(p.is_admin, false)
    ),
    neutral as (
        select m.user_id
        from members m
        where not exists (
            select 1 from stakes s
            where s.bet_id = p_bet_id
              and s.user_id = m.user_id
        )
        and not exists (
            select 1 from combo_legs l
            join combos c on c.id = l.combo_id
            where l.bet_id = p_bet_id
              and c.user_id = m.user_id
        )
    )
    -- Seuls les neutres votent, même s'ils ne sont qu'un ;
    -- tous les membres (hors créateur et admin) s'il n'y a aucun neutre.
    select user_id from neutral
    union all
    select user_id from members
    where not exists (select 1 from neutral);
$$;


-- ---------------------------------------------------------
-- 8. settle_contest : validation annulée = les combinés déjà
--    récupérés qui contiennent ce pari sont recalculés
-- ---------------------------------------------------------

create or replace function public.settle_contest(p_bet_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
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

    -- Combinés déjà récupérés qui contiennent ce pari : il en sort (cote 1),
    -- le gain est recalculé et la différence est reprise (ou donnée).
    -- Un combiné soldé « perdu » qui redevient en attente n'est plus soldé.
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

        if v_state.status in ('won', 'refunded')
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
$$;


-- ---------------------------------------------------------
-- 9. group_contests : un joueur en combiné apparaît comme
--    « a misé » (pas « hors du jury » sans raison)
-- ---------------------------------------------------------

create or replace function public.group_contests(p_group uuid)
returns table (
    bet_id uuid,
    question text,
    winner_label text,
    author_name text,
    opened_by_name text,
    reason text,
    opened_at timestamptz,
    ends_at timestamptz,
    status text,
    penalty numeric,
    total_staked numeric,
    jury_size integer,
    votes_annul integer,
    votes_keep integer,
    my_role text,
    my_vote boolean,
    settled_at timestamptz,
    opened_by_me boolean,
    my_stake numeric,
    my_choice_label text,
    my_win numeric,
    my_win_taken numeric,
    my_claimed boolean,
    commission numeric,
    commission_claimed boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_id uuid;
begin

    if not public.is_group_member(p_group) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    for v_id in
        select c.bet_id from bet_contests c
        where c.group_id = p_group
          and c.status = 'open'
          and c.ends_at <= now()
    loop
        perform public.settle_contest(v_id);
    end loop;

    return query
    select
        c.bet_id,
        b.question,
        wc.label,
        pa.username,
        po.username,
        c.reason,
        c.opened_at,
        c.ends_at,
        c.status,
        c.penalty,
        (select coalesce(sum(s.stake), 0) from stakes s where s.bet_id = c.bet_id),
        coalesce(c.jury_size, (select count(*)::integer from contest_jury(c.bet_id))),
        coalesce(c.votes_annul, (select count(*)::integer from bet_contest_votes v where v.bet_id = c.bet_id and v.annul)),
        coalesce(c.votes_keep, (select count(*)::integer from bet_contest_votes v where v.bet_id = c.bet_id and not v.annul)),
        case
            when b.author_id = v_user then 'author'
            when exists (select 1 from contest_jury(c.bet_id) j where j.user_id = v_user) then 'juror'
            when exists (select 1 from stakes s where s.bet_id = c.bet_id and s.user_id = v_user) then 'bettor'
            when exists (
                select 1 from combo_legs l
                join combos cb on cb.id = l.combo_id
                where l.bet_id = c.bet_id
                  and cb.user_id = v_user
            ) then 'bettor'
            else 'none'
        end,
        (select v.annul from bet_contest_votes v where v.bet_id = c.bet_id and v.user_id = v_user),
        c.settled_at,
        c.opened_by = v_user,
        coalesce(m.stake, 0),
        m.choice_label,
        coalesce(m.win, 0),
        coalesce(m.win_taken, 0),
        coalesce(m.claimed, false),
        coalesce((select bc.amount from bet_commissions bc where bc.bet_id = c.bet_id), 0),
        coalesce((select bc.claimed_at is not null and (bc.reversed_at is null or bc.claimed_at < bc.reversed_at)
                  from bet_commissions bc where bc.bet_id = c.bet_id), false)
    from bet_contests c
    join bets b on b.id = c.bet_id
    left join bet_choices wc on wc.id = b.winner_choice_id
    left join profiles pa on pa.id = b.author_id
    left join profiles po on po.id = c.opened_by
    left join lateral (
        select
            sum(s.stake) as stake,
            string_agg(sc.label, ', ') as choice_label,
            sum(s.potential_win) filter (where s.choice_id = b.winner_choice_id) as win,
            sum(s.potential_win) filter (
                where s.choice_id = b.winner_choice_id
                  and s.claimed_at is not null
                  and (c.settled_at is null or s.claimed_at < c.settled_at)
            ) as win_taken,
            bool_or(s.claimed_at is not null) as claimed
        from stakes s
        join bet_choices sc on sc.id = s.choice_id
        where s.bet_id = c.bet_id
          and s.user_id = v_user
    ) m on true
    where c.group_id = p_group
      and (c.status = 'open' or c.settled_at > now() - interval '7 days')
    order by (c.status = 'open') desc, c.opened_at desc;

end;
$$;


-- ---------------------------------------------------------
-- 10. En direct : un combiné placé rafraîchit les paris des
--     autres joueurs (le créateur voit son pari devenir validable)
-- ---------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'combo_legs'
    ) then
        alter publication supabase_realtime add table public.combo_legs;
    end if;
end;
$$;
