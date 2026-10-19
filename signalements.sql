-- =========================================================
-- BetLab : signaler un pari suspect (2026-10-19)
--
-- Maquette : Exemple-aide CLAUDE/demo-signaler-pari.html
--   - dans le profil d'un joueur, bouton « 🚩 Signaler » en bas de chaque
--     mise (simple ou combiné), en cours ou terminée ;
--   - motif à choisir + un détail facultatif ;
--   - l'admin voit une pastille sur son onglet et une carte « Paris signalés » ;
--   - il garde la mise, ou annule SEULEMENT la mise de ce joueur
--     (mise rendue, gain déjà récupéré repris, mise supprimée) ;
--   - celui qui a signalé reçoit un message avec la décision ;
--   - le joueur signalé est prévenu du signalement (sans le nom), puis de la décision.
--
-- Le joueur signalé ne sait pas qui l'a signalé.
-- Relançable.
-- =========================================================


create table if not exists public.bet_reports (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references groups(id) on delete cascade,
    reporter_id uuid not null references profiles(id) on delete cascade,
    reported_user_id uuid not null references profiles(id) on delete cascade,
    -- 'stake' (mise simple) ou 'combo'. Pas de clé étrangère : la mise
    -- annulée est supprimée mais le signalement reste.
    kind text not null check (kind in ('stake', 'combo')),
    target_id uuid not null,
    bet_id uuid,
    -- Copie de la mise au moment du signalement (elle peut disparaître).
    summary text not null,
    amount numeric not null,
    reason text not null,
    details text check (char_length(details) <= 300),
    status text not null default 'pending' check (status in ('pending', 'cancelled', 'kept')),
    created_at timestamptz not null default now(),
    decided_at timestamptz,
    unique (reporter_id, kind, target_id)
);

create index if not exists bet_reports_pending_idx
    on public.bet_reports (status, created_at);

create index if not exists bet_reports_target_idx
    on public.bet_reports (kind, target_id);

-- Tout passe par les fonctions ci-dessous.
alter table public.bet_reports enable row level security;

revoke all on public.bet_reports from anon, authenticated;


-- Signaler une mise d'un autre joueur du groupe.
create or replace function public.report_bet(
    p_kind text,
    p_target uuid,
    p_reason text,
    p_details text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_owner uuid;
    v_group uuid;
    v_bet uuid;
    v_summary text;
    v_amount numeric;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_reason not in ('Il connaissait déjà le résultat', 'Pari arrangé avec le créateur', 'Autre') then
        raise exception 'Motif inconnu.';
    end if;

    if p_kind = 'stake' then

        select s.user_id, b.group_id, b.id,
               b.question || ' → ' || ch.label,
               s.stake
        into v_owner, v_group, v_bet, v_summary, v_amount
        from stakes s
        join bets b on b.id = s.bet_id
        join bet_choices ch on ch.id = s.choice_id
        where s.id = p_target;

    elsif p_kind = 'combo' then

        select c.user_id, c.group_id, null,
               'Combiné : ' || (
                   select string_agg(b.question || ' → ' || ch.label, ' · ' order by b.question)
                   from combo_legs l
                   join bets b on b.id = l.bet_id
                   join bet_choices ch on ch.id = l.choice_id
                   where l.combo_id = c.id
               ),
               c.stake
        into v_owner, v_group, v_bet, v_summary, v_amount
        from combos c
        where c.id = p_target;

    else
        raise exception 'Type de mise inconnu.';
    end if;

    if v_owner is null then
        raise exception 'Cette mise n''existe plus.';
    end if;

    if v_owner = v_user then
        raise exception 'Tu ne peux pas signaler ta propre mise.';
    end if;

    if not public.is_group_member(v_group) then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if exists (
        select 1 from bet_reports
        where reporter_id = v_user and kind = p_kind and target_id = p_target
    ) then
        raise exception 'Tu as déjà signalé ce pari.';
    end if;

    -- Le joueur concerné est prévenu au premier signalement en attente
    -- (pas un message par joueur qui signale), sans savoir qui l'a signalé.
    if not exists (
        select 1 from bet_reports
        where kind = p_kind and target_id = p_target and status = 'pending'
    ) then

        insert into player_notices (user_id, title, content)
        values (
            v_owner,
            '🚩 Un de tes paris a été signalé',
            'Un joueur a signalé ta mise « ' || v_summary || ' » à l''admin, qui va la regarder.'
            || ' Tu recevras un message avec sa décision.'
        );

    end if;

    insert into bet_reports (group_id, reporter_id, reported_user_id, kind, target_id, bet_id, summary, amount, reason, details)
    values (v_group, v_user, v_owner, p_kind, p_target, v_bet, v_summary, v_amount, p_reason,
            nullif(left(btrim(coalesce(p_details, '')), 300), ''));

end;
$$;


-- Mises que j'ai déjà signalées (pour afficher « 🚩 Signalé » dans le profil).
create or replace function public.my_bet_reports()
returns table (kind text, target_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
    select kind, target_id from bet_reports where reporter_id = auth.uid();
$$;


-- Admin : signalements à traiter, puis les 15 dernières décisions.
-- Plusieurs joueurs qui signalent la même mise = une seule ligne.
create or replace function public.admin_bet_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin

    if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
        raise exception 'Réservé à l''admin.';
    end if;

    return coalesce((
        select jsonb_agg(row_to_json(y) order by y.pending desc, y.last_at desc)
        from (
        select x.*
        from (
            select r.kind, r.target_id,
                   bool_or(r.status = 'pending') as pending,
                   (array_agg(r.status order by r.created_at desc))[1] as status,
                   max(coalesce(r.decided_at, r.created_at)) as last_at,
                   min(r.created_at) as created_at,
                   (array_agg(r.summary))[1] as summary,
                   (array_agg(r.amount))[1] as amount,
                   (select username from profiles where id = (array_agg(r.reported_user_id))[1]) as reported,
                   (select g.name from groups g where g.id = (array_agg(r.group_id))[1]) as group_name,
                   jsonb_agg(jsonb_build_object(
                       'reporter', p.username,
                       'reason', r.reason,
                       'details', r.details,
                       'created_at', r.created_at
                   ) order by r.created_at) as reports
            from bet_reports r
            join profiles p on p.id = r.reporter_id
            group by r.kind, r.target_id
        ) x
        where x.pending
           or x.last_at > now() - interval '30 days'
        order by x.pending desc, x.last_at desc
        limit 50
        ) y
    ), '[]'::jsonb);

end;
$$;


-- Admin : garder la mise, ou l'annuler (seulement celle de ce joueur).
create or replace function public.admin_decide_report(p_kind text, p_target uuid, p_cancel boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_user uuid := auth.uid();
    v_stake record;
    v_bet record;
    v_combo record;
    v_owner uuid;
    v_summary text;
    v_delta numeric := 0;
    v_commission record;
    v_new_commission numeric;
    v_reporter record;
begin

    if v_user is null
        or not exists (select 1 from profiles where id = v_user and is_admin)
    then
        raise exception 'Réservé à l''admin.';
    end if;

    select reported_user_id, summary into v_owner, v_summary
    from bet_reports
    where kind = p_kind and target_id = p_target and status = 'pending'
    limit 1;

    if v_owner is null then
        raise exception 'Ce signalement a déjà été traité.';
    end if;


    if p_cancel and p_kind = 'stake' then

        select * into v_stake from stakes where id = p_target for update;

        if v_stake is null then
            raise exception 'Cette mise n''existe plus.';
        end if;

        select * into v_bet from bets where id = v_stake.bet_id for update;

        if v_bet.status = 'cancelled' then
            raise exception 'Ce pari est déjà annulé : la mise a déjà été rendue.';
        end if;

        -- Mise rendue ; gain déjà récupéré repris.
        v_delta := v_stake.stake - case
            when v_bet.status = 'resolved'
                 and v_stake.claimed_at is not null
                 and v_stake.choice_id = v_bet.winner_choice_id
            then v_stake.potential_win else 0 end;

        update group_members
        set balance = balance + v_delta
        where group_id = v_bet.group_id and user_id = v_stake.user_id;

        delete from stakes where id = p_target;

        -- Mise perdue d'un autre que le créateur : elle comptait dans
        -- la commission du créateur (10 % des mises perdues), on la recalcule.
        if v_bet.status = 'resolved'
            and v_stake.choice_id <> v_bet.winner_choice_id
            and v_stake.user_id is distinct from v_bet.author_id
        then

            select * into v_commission
            from bet_commissions
            where bet_id = v_bet.id and reversed_at is null
            for update;

            -- « found » : une ligne avec reversed_at vide n'est pas « is not null ».
            if found then

                select round(coalesce(sum(stake), 0) * 0.10) into v_new_commission
                from stakes
                where bet_id = v_bet.id
                  and choice_id <> v_bet.winner_choice_id
                  and user_id <> v_bet.author_id;

                if v_new_commission < v_commission.amount then

                    update bet_commissions
                    set amount = v_new_commission
                    where bet_id = v_bet.id;

                    if v_commission.claimed_at is not null then
                        update group_members
                        set balance = balance - (v_commission.amount - v_new_commission)
                        where group_id = v_bet.group_id and user_id = v_bet.author_id;
                    end if;

                end if;

            end if;

        end if;

    elsif p_cancel and p_kind = 'combo' then

        select * into v_combo from combos where id = p_target for update;

        if v_combo is null then
            raise exception 'Ce combiné n''existe plus.';
        end if;

        -- Mise rendue ; ce qui a déjà été récupéré est repris.
        v_delta := v_combo.stake - case
            when v_combo.claimed_at is not null then coalesce(v_combo.claimed_amount, 0)
            else 0 end;

        update group_members
        set balance = balance + v_delta
        where group_id = v_combo.group_id and user_id = v_combo.user_id;

        delete from combos where id = p_target;

    end if;


    if p_cancel then

        insert into player_notices (user_id, title, content)
        values (
            v_owner,
            '🚫 Mise annulée par l''admin',
            'Après un signalement, l''admin a annulé ta mise « ' || v_summary || ' ».'
            || case when v_delta > 0
                    then ' Elle t''a été rendue (+' || public.format_euros(v_delta) || ').'
                    when v_delta < 0
                    then ' Le gain que tu avais récupéré a été repris, ta mise rendue (' || public.format_euros(v_delta) || ').'
                    else '' end
        );

    else

        -- Il a été prévenu du signalement : il apprend aussi que sa mise est gardée.
        insert into player_notices (user_id, title, content)
        values (
            v_owner,
            '✅ Ta mise est gardée',
            'L''admin a regardé le signalement sur ta mise « ' || v_summary || ' » et l''a gardée.'
        );

    end if;

    -- Chaque joueur qui l'a signalée reçoit la décision.
    for v_reporter in
        select distinct reporter_id
        from bet_reports
        where kind = p_kind and target_id = p_target and status = 'pending'
    loop

        insert into player_notices (user_id, title, content)
        values (
            v_reporter.reporter_id,
            '🚩 Ton signalement',
            case when p_cancel
                 then 'L''admin a annulé la mise que tu as signalée (« ' || v_summary || ' ») : elle a été rendue au joueur.'
                 else 'L''admin a regardé la mise que tu as signalée (« ' || v_summary || ' ») et l''a gardée.' end
        );

    end loop;

    update bet_reports
    set status = case when p_cancel then 'cancelled' else 'kept' end,
        decided_at = now()
    where kind = p_kind and target_id = p_target and status = 'pending';

end;
$$;


-- Mise simple annulée : le joueur ne peut plus miser sur ce pari.
create or replace function public.block_cancelled_restake()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if exists (
        select 1 from bet_reports
        where kind = 'stake'
          and bet_id = new.bet_id
          and reported_user_id = new.user_id
          and status = 'cancelled'
    ) then
        raise exception 'Ta mise sur ce pari a été annulée par l''admin : tu ne peux plus miser dessus.';
    end if;

    return new;

end;
$$;

drop trigger if exists stakes_block_cancelled_restake on public.stakes;

create trigger stakes_block_cancelled_restake
before insert on public.stakes
for each row execute function public.block_cancelled_restake();


revoke all on function public.report_bet(text, uuid, text, text) from public, anon;
revoke all on function public.my_bet_reports() from public, anon;
revoke all on function public.admin_bet_reports() from public, anon;
revoke all on function public.admin_decide_report(text, uuid, boolean) from public, anon;

grant execute on function public.report_bet(text, uuid, text, text) to authenticated;
grant execute on function public.my_bet_reports() to authenticated;
grant execute on function public.admin_bet_reports() to authenticated;
grant execute on function public.admin_decide_report(text, uuid, boolean) to authenticated;


-- player_profile reprise telle qu'elle est en base (2026-10-19) :
-- seul l'identifiant de chaque mise simple (stake_id) est ajouté, pour la signaler.

CREATE OR REPLACE FUNCTION public.player_profile(p_group uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Rang au classement du groupe (l'admin n'est pas classÃ©).
    select count(*) + 1 into v_rank
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = p_group
      and not p.is_admin
      and gm.balance > v_member.balance;

    -- Argent en jeu : mises sur des paris pas encore validÃ©s, et combinÃ©s en cours.
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

    -- 30 derniÃ¨res mises simples.
    select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v_stakes
    from (
        select s.id as stake_id, s.bet_id, b.question, s.choice_id, ch.label,
               round((s.potential_win / nullif(s.stake, 0) / (case when s.boosted then 1.2 else 1 end)), 2) as odds,
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

    -- 20 derniers combinÃ©s, avec leurs paris.
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
        -- SÃ©rie encore valable : derniÃ¨re visite aujourd'hui ou hier.
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
$function$;
