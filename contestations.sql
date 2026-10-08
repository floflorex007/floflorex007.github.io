-- =========================================================
-- BetLab : contester un pari validé
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal.
--
-- Règles :
--   - un joueur qui a misé sur le pari (pas le créateur) peut
--     le contester pendant 24 h après sa validation ;
--   - une seule contestation par pari : elle ouvre un vote de 24 h ;
--   - le jury : les membres du groupe qui n'ont PAS misé sur ce pari,
--     sans le créateur ni l'admin, même s'il n'y en a qu'un. S'il n'y
--     en a aucun, tous les membres votent (toujours sans le créateur
--     ni l'admin) ;
--   - le vote s'arrête dès qu'une majorité du jury est acquise,
--     sinon au bout de 24 h (majorité des votes ; égalité = maintenu) ;
--   - pendant le vote, les gains du pari sont bloqués ;
--   - validation annulée : chacun retrouve sa mise (si un gain a déjà
--     été récupéré, il est repris), le pari passe « cancelled »,
--     et le créateur paie une amende de 10 % du total misé.
--
-- Pas de tâche planifiée : la fin d'un vote est constatée au prochain
-- passage (ouverture du site, vote, récupération des gains).
-- =========================================================


-- ---------------------------------------------------------
-- 1. Pari annulé + date de validation
-- ---------------------------------------------------------

alter table public.bets drop constraint if exists bets_status_check;

alter table public.bets
    add constraint bets_status_check
    check (status = any (array['open', 'closed', 'resolved', 'cancelled']));

alter table public.bets add column if not exists resolved_at timestamptz;

create or replace function public.bets_stamp_resolved()
returns trigger
language plpgsql
as $$
begin

    if new.status = 'resolved' and old.status is distinct from 'resolved' then
        new.resolved_at := now();
    end if;

    return new;

end;
$$;

drop trigger if exists bets_stamp_resolved on public.bets;

create trigger bets_stamp_resolved
    before update on public.bets
    for each row
    execute function public.bets_stamp_resolved();


-- ---------------------------------------------------------
-- 2. Tables des contestations et des votes
-- ---------------------------------------------------------

create table if not exists public.bet_contests (
    bet_id uuid primary key references public.bets (id) on delete cascade,
    group_id uuid not null references public.groups (id) on delete cascade,
    opened_by uuid not null references public.profiles (id) on delete cascade,
    reason text,
    opened_at timestamptz not null default now(),
    ends_at timestamptz not null,
    status text not null default 'open' check (status in ('open', 'upheld', 'annulled')),
    settled_at timestamptz,
    jury_size integer,
    votes_annul integer,
    votes_keep integer,
    penalty numeric
);

create table if not exists public.bet_contest_votes (
    bet_id uuid not null references public.bet_contests (bet_id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    annul boolean not null,
    voted_at timestamptz not null default now(),
    primary key (bet_id, user_id)
);

alter table public.bet_contests enable row level security;

alter table public.bet_contest_votes enable row level security;

-- Lecture pour les membres du groupe ; les écritures passent par les fonctions ci-dessous.
drop policy if exists bet_contests_select_group on public.bet_contests;

create policy bet_contests_select_group on public.bet_contests
    for select using (public.is_group_member(group_id));

drop policy if exists bet_contest_votes_select_group on public.bet_contest_votes;

create policy bet_contest_votes_select_group on public.bet_contest_votes
    for select using (
        exists (
            select 1 from public.bet_contests c
            where c.bet_id = bet_contest_votes.bet_id
              and public.is_group_member(c.group_id)
        )
    );


-- ---------------------------------------------------------
-- 3. Le jury d'un pari
-- ---------------------------------------------------------

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
    )
    -- Seuls les neutres votent, même s'ils ne sont qu'un ;
    -- tous les membres (hors créateur et admin) s'il n'y a aucun neutre.
    select user_id from neutral
    union all
    select user_id from members
    where not exists (select 1 from neutral);
$$;


-- ---------------------------------------------------------
-- 4. Fin d'un vote (majorité acquise ou 24 h écoulées)
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
-- 5. Contester un pari
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


-- ---------------------------------------------------------
-- 6. Voter (jury seulement, un vote définitif)
-- ---------------------------------------------------------

create or replace function public.vote_contest(p_bet_id uuid, p_annul boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if public.settle_contest(p_bet_id) is distinct from 'open' then
        raise exception 'Le vote est terminé.';
    end if;

    if not exists (select 1 from contest_jury(p_bet_id) j where j.user_id = v_user) then
        raise exception 'Tu ne fais pas partie du jury de ce pari.';
    end if;

    if exists (
        select 1 from bet_contest_votes
        where bet_id = p_bet_id
          and user_id = v_user
    ) then
        raise exception 'Tu as déjà voté.';
    end if;

    insert into bet_contest_votes (bet_id, user_id, annul)
    values (p_bet_id, v_user, p_annul);

    return public.settle_contest(p_bet_id);

end;
$$;


-- ---------------------------------------------------------
-- 7. Contestations d'un groupe (pour l'Historique)
--    Termine d'abord les votes arrivés au bout des 24 h.
--    Les colonnes my_* servent à l'animation de fin de vote :
--    my_win_taken = gain récupéré AVANT la fin du vote
--    (settle_contest marque les autres mises à settled_at).
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
    my_claimed boolean
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
        coalesce(m.claimed, false)
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
-- 8. claim_bet : gains bloqués pendant le vote
--    (reprise de recuperation.sql / groupes, seul le début change)
-- ---------------------------------------------------------

create or replace function public.claim_bet(p_bet_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_winner uuid;
    v_status text;
    v_group uuid;
    v_total numeric := 0;
    v_count integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    -- Un vote arrivé à son terme se termine avant de récupérer.
    if public.settle_contest(p_bet_id) = 'open' then
        raise exception 'Contestation en cours : les gains sont bloqués jusqu''à la fin du vote.';
    end if;

    select status, winner_choice_id, group_id into v_status, v_winner, v_group
    from bets
    where id = p_bet_id;

    if v_status = 'cancelled' then
        raise exception 'Ce pari a été annulé après contestation : ta mise t''a été rendue.';
    end if;

    if v_status is distinct from 'resolved' then
        raise exception 'Ce pari n''est pas encore validé.';
    end if;

    -- Verrouille le solde du groupe pour éviter deux récupérations simultanées.
    perform 1 from group_members
    where group_id = v_group and user_id = v_user
    for update;

    if not found then
        raise exception 'Tu ne fais plus partie de ce groupe.';
    end if;

    select count(*), coalesce(sum(case when choice_id = v_winner then potential_win else 0 end), 0)
    into v_count, v_total
    from stakes
    where bet_id = p_bet_id
      and user_id = v_user
      and claimed_at is null;

    if v_count = 0 then
        raise exception 'Rien à récupérer sur ce pari.';
    end if;

    update stakes
    set claimed_at = now()
    where bet_id = p_bet_id
      and user_id = v_user
      and claimed_at is null;

    if v_total > 0 then
        update group_members
        set balance = balance + v_total
        where group_id = v_group
          and user_id = v_user;
    end if;

    return v_total;

end;
$$;


-- ---------------------------------------------------------
-- 9. resolve_bet : un pari annulé ne peut pas être revalidé
--    (reprise de la version en base, seule la vérification du statut change)
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

end;
$$;
