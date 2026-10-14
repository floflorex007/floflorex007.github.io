-- =========================================================
-- BetLab : arbre du groupe, les combinés rapportent de l'XP de groupe
--
--   - l'XP de la mise d'un combiné (stake_xp), comme une mise simple
--   - +25 par combiné gagné
--   - un joueur qui a mis un pari dans son combiné compte comme
--     parieur de ce pari (pour « 2 parieurs » et « tout le groupe »)
--
-- Remplace group_xp_parts (arbre-groupe.sql). À lancer après lui.
--
-- Seuils relevés à 2 000 / 16 000 / 65 000 XP : avec les combinés,
-- Les Fous du BE font ≈ 2 300 XP par jour (1 jour, 1 semaine, 1 mois).
-- =========================================================


create or replace function public.group_xp_parts(p_group uuid)
returns table (mises integer, gagnes integer, resolus integer, tous integer)
language sql
stable
security definer
set search_path = public
as $$
    with g as (
        select tree_started_at as at
        from groups
        where id = p_group and tree_started_at is not null
    ),
    nb_members as (
        select count(*) as n
        from group_members gm
        join profiles p on p.id = gm.user_id
        where gm.group_id = p_group
          and not coalesce(p.is_admin, false)
    ),
    s as (
        select st.*, b.status, b.winner_choice_id
        from stakes st
        join bets b on b.id = st.bet_id
        join profiles p on p.id = st.user_id
        cross join g
        where b.group_id = p_group
          and st.created_at >= g.at
          and not coalesce(p.is_admin, false)
    ),
    c as (
        select co.*
        from combos co
        join profiles p on p.id = co.user_id
        cross join g
        where co.group_id = p_group
          and co.created_at >= g.at
          and not coalesce(p.is_admin, false)
    ),
    -- Parieurs de chaque pari : mises simples et combinés.
    bettors as (
        select bet_id, user_id from s
        union
        select l.bet_id, c.user_id
        from c
        join combo_legs l on l.combo_id = c.id
    ),
    resolved as (
        select bt.bet_id, count(distinct bt.user_id) as nb
        from bettors bt
        join bets b on b.id = bt.bet_id
        cross join g
        where b.status = 'resolved'
          and coalesce(b.resolved_at, now()) >= g.at
        group by bt.bet_id
    )
    select
        (coalesce((select sum(stake_xp(stake)) from s), 0)
         + coalesce((select sum(stake_xp(stake)) from c), 0))::integer,
        (coalesce((select count(*) * 25
                   from s
                   where status = 'resolved'
                     and winner_choice_id = choice_id), 0)
         + coalesce((select count(*) * 25
                     from c, public.combo_state(c.id) cs
                     where cs.status = 'won'), 0))::integer,
        coalesce((select count(*) * 60 from resolved where nb >= 2), 0)::integer,
        coalesce((select count(*) * 100
                  from resolved, nb_members
                  where nb >= 2 and nb >= nb_members.n), 0)::integer;
$$;


create or replace function public.tree_threshold(p_level integer)
returns integer
language sql
immutable
as $$
    select (array[2000, 16000, 65000])[p_level];
$$;
