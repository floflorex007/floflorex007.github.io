-- =========================================================
-- BetLab : commission du créateur
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après contestations.sql.
--
-- Le créateur peut miser sur son pari (createur-peut-miser.sql) ;
-- à la validation, il gagne 10 % des mises perdues (arrondi
-- à l'euro, ses propres mises exclues). La commission
-- se récupère avec une carte jaune sur la page des paris
-- (claim_commission), bloquée pendant une contestation comme les
-- gains. Si une contestation annule la validation, une commission
-- déjà récupérée est reprise (en plus de l'amende), sinon elle
-- est simplement annulée.
-- Même calcul côté site : creatorCommission() dans app.js.
--
-- Reprend de contestations.sql : resolve_bet, settle_contest et
-- group_contests (nouvelles colonnes commission et
-- commission_claimed) ; seul ce qui concerne la commission change.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Table des commissions (une par pari validé)
-- ---------------------------------------------------------

create table if not exists public.bet_commissions (
    bet_id uuid primary key references public.bets (id) on delete cascade,
    group_id uuid not null,
    user_id uuid not null references public.profiles (id) on delete cascade,
    amount numeric not null,
    created_at timestamptz not null default now(),
    claimed_at timestamptz,
    reversed_at timestamptz
);

-- Première version : la commission était versée dès la validation.
-- Les 2 commissions déjà versées ainsi (paris « Test » et « New »,
-- 2026-10-08) sont marquées comme récupérées.
alter table public.bet_commissions add column if not exists claimed_at timestamptz;

update public.bet_commissions
set claimed_at = created_at
where claimed_at is null
  and bet_id in ('b0266a21-9941-4fa7-84f6-53f545e9d7b9', '601350ed-3d34-4df7-b618-54634741c419');

alter table public.bet_commissions enable row level security;

-- Lecture pour les membres du groupe ; les écritures passent par les fonctions.
drop policy if exists bet_commissions_select_group on public.bet_commissions;

create policy bet_commissions_select_group on public.bet_commissions
    for select using (public.is_group_member(group_id));


-- ---------------------------------------------------------
-- 2. resolve_bet : commission mise de côté (à récupérer)
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


-- ---------------------------------------------------------
-- 3. settle_contest : commission reprise si la validation est annulée
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
-- 4. group_contests : commission du pari (fiche de fin de vote)
-- ---------------------------------------------------------

drop function if exists public.group_contests(uuid);

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
-- 5. claim_commission : la carte jaune « Récupérer ma commission »
-- ---------------------------------------------------------

create or replace function public.claim_commission(p_bet_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_row record;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    -- Un vote arrivé à son terme se termine avant de récupérer.
    if public.settle_contest(p_bet_id) = 'open' then
        raise exception 'Contestation en cours : ta commission est bloquée jusqu''à la fin du vote.';
    end if;

    select * into v_row
    from bet_commissions
    where bet_id = p_bet_id
    for update;

    if v_row is null or v_row.user_id is distinct from v_user then
        raise exception 'Pas de commission à récupérer sur ce pari.';
    end if;

    if v_row.reversed_at is not null then
        raise exception 'La validation a été annulée après contestation : plus de commission.';
    end if;

    if v_row.claimed_at is not null then
        raise exception 'Commission déjà récupérée.';
    end if;

    update group_members
    set balance = balance + v_row.amount
    where group_id = v_row.group_id
      and user_id = v_user;

    if not found then
        raise exception 'Tu ne fais plus partie de ce groupe.';
    end if;

    update bet_commissions
    set claimed_at = now()
    where bet_id = p_bet_id;

    return v_row.amount;

end;
$$;
