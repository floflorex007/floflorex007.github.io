-- =========================================================
-- BetLab : fenêtre d'un participant (clic sur un pseudo)
--
-- - Skin du perroquet choisi, enregistré dans le profil
--   (avant, il n'était connu que du navigateur du joueur).
-- - player_profile : stats (XP, série, solde, pièces, diamants,
--   argent en jeu, rang) et historique des paris et combinés
--   d'un membre du groupe (version B de demo-profil-joueur.html).
--
-- À lancer après diamants.sql, admin-stats.sql et combines.sql.
-- =========================================================


alter table public.profiles
    add column if not exists parrot_skin text not null default 'classique';


-- Le joueur enregistre son skin (seulement les skins qui existent).
create or replace function public.set_parrot_skin(p_skin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

    if p_skin not in ('classique', 'flamant', 'nuit', 'violet', 'arctique', 'noir', 'phenix', 'cristal') then
        raise exception 'Skin inconnu.';
    end if;

    update profiles
    set parrot_skin = p_skin
    where id = auth.uid();

end;
$$;


create or replace function public.player_profile(p_group uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_profile record;
    v_member record;
    v_yesterday date := (now() at time zone 'Europe/Paris')::date - 1;
    v_rank integer;
    v_in_play numeric;
    v_stakes jsonb;
    v_combos jsonb;
begin

    if not public.is_group_member(p_group) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    select * into v_profile from profiles where id = p_user;

    select * into v_member from group_members where group_id = p_group and user_id = p_user;

    if v_profile is null or v_member is null then
        raise exception 'Ce joueur ne fait pas partie du groupe.';
    end if;

    -- Rang au classement du groupe (l'admin n'est pas classé).
    select count(*) + 1 into v_rank
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = p_group
      and not p.is_admin
      and gm.balance > v_member.balance;

    -- Argent en jeu : mises sur des paris pas encore validés, et combinés en cours.
    select coalesce(sum(s.stake), 0) into v_in_play
    from stakes s
    join bets b on b.id = s.bet_id
    where s.user_id = p_user
      and b.group_id = p_group
      and b.status in ('open', 'closed', 'draft');

    v_in_play := v_in_play + coalesce((
        select sum(c.stake)
        from combos c
        where c.user_id = p_user
          and c.group_id = p_group
          and (select st.status from combo_state(c.id) st) = 'open'
    ), 0);

    -- 30 dernières mises simples.
    select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v_stakes
    from (
        select s.bet_id, b.question, s.choice_id, ch.label,
               round(s.potential_win / nullif(s.stake, 0), 2) as odds,
               s.stake, s.potential_win, s.created_at,
               b.status, b.winner_choice_id, b.deadline_at
        from stakes s
        join bets b on b.id = s.bet_id
        join bet_choices ch on ch.id = s.choice_id
        where s.user_id = p_user
          and b.group_id = p_group
        order by s.created_at desc
        limit 30
    ) x;

    -- 20 derniers combinés, avec leurs paris.
    select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v_combos
    from (
        select c.id, c.stake, c.odds, c.potential_win, c.created_at,
               (select st.status from combo_state(c.id) st) as state,
               (
                   select jsonb_agg(jsonb_build_object(
                       'bet_id', l.bet_id,
                       'question', b.question,
                       'choice_id', l.choice_id,
                       'label', ch.label,
                       'odds', l.odds
                   ))
                   from combo_legs l
                   join bets b on b.id = l.bet_id
                   join bet_choices ch on ch.id = l.choice_id
                   where l.combo_id = c.id
               ) as legs
        from combos c
        where c.user_id = p_user
          and c.group_id = p_group
        order by c.created_at desc
        limit 20
    ) x;

    return jsonb_build_object(
        'username', v_profile.username,
        'is_admin', v_profile.is_admin,
        'created_at', v_profile.created_at,
        'xp', public.player_xp_of(p_user),
        -- Série encore valable : dernière visite aujourd'hui ou hier.
        'streak', case when v_profile.last_checkin >= v_yesterday then v_profile.streak_days else 0 end,
        'balance', v_member.balance,
        'points', v_member.points,
        'diamonds', v_profile.diamonds,
        'parrot_skin', v_profile.parrot_skin,
        'rank', v_rank,
        'in_play', v_in_play,
        'stakes', v_stakes,
        'combos', v_combos
    );

end;
$$;
