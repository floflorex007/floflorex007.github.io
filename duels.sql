-- =========================================================
-- BetLab : duels 1 contre 1 et séries de victoires
-- (maquette demo-duels-classement.html)
--
-- Duel : depuis le classement, un joueur en défie un autre sur un
-- pari ouvert du groupe, avec la même mise. Le défié a 24 h pour
-- accepter (en prenant un autre choix). Le gagnant récupère les
-- 2 mises dès que le pari est validé. Si aucun des deux choix ne
-- gagne, chacun récupère sa mise. Pari annulé : tout est rendu.
--
-- Série de victoires : nombre de mises gagnées d'affilée (simples
-- et combinés validés) dans le groupe ; badge à partir de 3.
-- =========================================================


create table if not exists public.duels (
    id uuid primary key default gen_random_uuid(),
    group_id uuid not null references public.groups(id) on delete cascade,
    bet_id uuid not null references public.bets(id) on delete cascade,
    challenger uuid not null references public.profiles(id) on delete cascade,
    opponent uuid not null references public.profiles(id) on delete cascade,
    challenger_choice uuid not null references public.bet_choices(id) on delete cascade,
    opponent_choice uuid references public.bet_choices(id) on delete cascade,
    amount numeric not null check (amount > 0),
    status text not null default 'pending'
        check (status in ('pending', 'active', 'won', 'draw', 'refused', 'expired', 'cancelled')),
    winner uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    answered_at timestamptz,
    settled_at timestamptz
);

create index if not exists duels_group_idx on public.duels (group_id, status);
create index if not exists duels_bet_idx on public.duels (bet_id);

-- Lecture par les membres du groupe ; écriture seulement par les fonctions.
alter table public.duels enable row level security;

drop policy if exists "duels lisibles par le groupe" on public.duels;
create policy "duels lisibles par le groupe"
    on public.duels for select
    using (public.is_group_member(group_id));


-- Ajoute (ou retire) de l'argent au solde d'un joueur dans le groupe.
create or replace function public.duel_pay(p_group uuid, p_user uuid, p_amount numeric)
returns void
language sql
security definer
set search_path = public
as $$
    update group_members
    set balance = balance + p_amount
    where group_id = p_group and user_id = p_user;
$$;

revoke execute on function public.duel_pay(uuid, uuid, numeric) from public, anon, authenticated;


create or replace function public.duel_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select username from profiles where id = p_user;
$$;


-- Défis en attente trop vieux (24 h) ou dont le pari n'est plus ouvert :
-- la mise du défieur lui est rendue.
create or replace function public.duel_expire(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
begin
    for v_duel in
        select d.*, b.question
        from duels d
        join bets b on b.id = d.bet_id
        where d.group_id = p_group
          and d.status = 'pending'
          and (d.expires_at <= now()
               or b.status <> 'open'
               or (b.deadline_at is not null and b.deadline_at <= now()))
        for update of d
    loop
        perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

        update duels set status = 'expired', settled_at = now() where id = v_duel.id;

        insert into player_notices (user_id, title, content)
        values (v_duel.challenger, '⚔️ Défi expiré',
                duel_name(v_duel.opponent) || ' n''a pas répondu à ton défi sur « ' || v_duel.question
                || ' ». Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').');
    end loop;
end;
$$;


-- Lancer un défi : ma mise est retenue tout de suite.
create or replace function public.duel_challenge(p_group uuid, p_opponent uuid, p_choice uuid, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_bet record;
    v_balance numeric;
    v_id uuid;
begin
    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    if p_opponent = v_user then
        raise exception 'Tu ne peux pas te défier toi-même.';
    end if;

    if exists (select 1 from profiles where id in (v_user, p_opponent) and is_admin) then
        raise exception 'Les duels ne sont pas possibles avec le compte admin.';
    end if;

    if not exists (select 1 from group_members where group_id = p_group and user_id = p_opponent) then
        raise exception 'Ce joueur ne fait pas partie du groupe.';
    end if;

    if p_amount is null or p_amount <> trunc(p_amount) or p_amount < 10 or p_amount > 5000 then
        raise exception 'La mise d''un duel va de 10 € à 5 000 €, sans centimes.';
    end if;

    select b.* into v_bet
    from bet_choices c
    join bets b on b.id = c.bet_id
    where c.id = p_choice;

    if v_bet is null or v_bet.group_id <> p_group then
        raise exception 'Ce pari ne fait pas partie du groupe.';
    end if;

    if v_bet.status <> 'open' or (v_bet.deadline_at is not null and v_bet.deadline_at <= now()) then
        raise exception 'Ce pari n''est plus ouvert.';
    end if;

    if v_bet.author_id in (v_user, p_opponent) then
        raise exception 'Pas de duel sur un pari créé par l''un de vous deux.';
    end if;

    if v_bet.target_blocked and v_bet.target_user_id in (v_user, p_opponent) then
        raise exception 'Ce pari concerne l''un de vous deux : pas de duel dessus.';
    end if;

    if exists (
        select 1 from duels
        where bet_id = v_bet.id
          and status in ('pending', 'active')
          and ((challenger = v_user and opponent = p_opponent) or (challenger = p_opponent and opponent = v_user))
    ) then
        raise exception 'Il y a déjà un duel entre vous deux sur ce pari.';
    end if;

    select balance into v_balance
    from group_members
    where group_id = p_group and user_id = v_user
    for update;

    if v_balance is null then
        raise exception 'Tu ne fais pas partie de ce groupe.';
    end if;

    if p_amount > v_balance then
        raise exception 'Solde insuffisant : tu as % €.', round(v_balance);
    end if;

    perform duel_pay(p_group, v_user, -p_amount);

    insert into duels (group_id, bet_id, challenger, opponent, challenger_choice, amount, expires_at)
    values (p_group, v_bet.id, v_user, p_opponent, p_choice, p_amount,
            least(now() + interval '24 hours', coalesce(v_bet.deadline_at, now() + interval '24 hours')))
    returning id into v_id;

    insert into player_notices (user_id, title, content)
    values (p_opponent, '⚔️ Tu es défié !',
            duel_name(v_user) || ' te défie sur « ' || v_bet.question || ' » : '
            || format_euros(p_amount) || ' chacun. Réponds depuis la page Paris (24 h).');

    return v_id;
end;
$$;


-- Répondre à un défi : accepter (avec un autre choix) ou refuser.
create or replace function public.duel_answer(p_duel uuid, p_accept boolean, p_choice uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_duel record;
    v_balance numeric;
begin
    select group_id into v_duel from duels where id = p_duel;

    if v_duel is null then
        raise exception 'Défi introuvable.';
    end if;

    perform duel_expire(v_duel.group_id);

    select d.*, b.question into v_duel
    from duels d
    join bets b on b.id = d.bet_id
    where d.id = p_duel
    for update of d;

    if v_duel.opponent is distinct from v_user then
        raise exception 'Ce défi ne t''est pas adressé.';
    end if;

    if v_duel.status <> 'pending' then
        raise exception 'Ce défi n''attend plus de réponse.';
    end if;

    if not p_accept then
        perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

        update duels set status = 'refused', answered_at = now(), settled_at = now() where id = p_duel;

        insert into player_notices (user_id, title, content)
        values (v_duel.challenger, '⚔️ Défi refusé',
                duel_name(v_user) || ' a refusé ton défi sur « ' || v_duel.question
                || ' ». Ta mise t''a été rendue (+' || format_euros(v_duel.amount) || ').');
        return;
    end if;

    if not exists (select 1 from bet_choices where id = p_choice and bet_id = v_duel.bet_id)
        or p_choice = v_duel.challenger_choice then
        raise exception 'Choisis un autre choix que celui de ton adversaire.';
    end if;

    select balance into v_balance
    from group_members
    where group_id = v_duel.group_id and user_id = v_user
    for update;

    if v_balance is null or v_duel.amount > v_balance then
        raise exception 'Solde insuffisant : il faut % €.', round(v_duel.amount);
    end if;

    perform duel_pay(v_duel.group_id, v_user, -v_duel.amount);

    update duels
    set status = 'active', opponent_choice = p_choice, answered_at = now()
    where id = p_duel;

    insert into player_notices (user_id, title, content)
    values (v_duel.challenger, '⚔️ Duel accepté !',
            duel_name(v_user) || ' a accepté ton duel sur « ' || v_duel.question
            || ' ». Le gagnant récupère ' || format_euros(v_duel.amount * 2) || '.');
end;
$$;


-- Le défieur peut retirer un défi tant qu'il n'a pas de réponse.
create or replace function public.duel_cancel(p_duel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
begin
    select * into v_duel from duels where id = p_duel for update;

    if v_duel is null or v_duel.challenger is distinct from auth.uid() then
        raise exception 'Ce défi n''est pas le tien.';
    end if;

    if v_duel.status <> 'pending' then
        raise exception 'Ce défi a déjà une réponse.';
    end if;

    perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

    update duels set status = 'cancelled', settled_at = now() where id = p_duel;
end;
$$;


-- Mes duels en cours (reçus, envoyés, acceptés), pour la page Paris.
create or replace function public.my_duels(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform duel_expire(p_group);

    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', d.id,
            'status', d.status,
            'amount', d.amount,
            'expires_at', d.expires_at,
            'bet_id', d.bet_id,
            'question', b.question,
            'challenger', duel_name(d.challenger),
            'challenger_id', d.challenger,
            'opponent', duel_name(d.opponent),
            'incoming', d.opponent = auth.uid(),
            'challenger_choice', d.challenger_choice,
            'challenger_label', (select label from bet_choices where id = d.challenger_choice),
            'opponent_label', (select label from bet_choices where id = d.opponent_choice),
            'choices', (select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'odds', c.odds) order by c.created_at)
                        from bet_choices c where c.bet_id = d.bet_id)
        ) order by d.created_at)
        from duels d
        join bets b on b.id = d.bet_id
        where d.group_id = p_group
          and d.status in ('pending', 'active')
          and auth.uid() in (d.challenger, d.opponent)
    ), '[]'::jsonb);
end;
$$;


-- Tête-à-tête : mes victoires et défaites contre un joueur (duels terminés).
create or replace function public.duel_h2h(p_group uuid, p_other uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'wins', count(*) filter (where status = 'won' and winner = auth.uid()),
        'losses', count(*) filter (where status = 'won' and winner = p_other),
        'draws', count(*) filter (where status = 'draw')
    )
    from duels
    where group_id = p_group
      and ((challenger = auth.uid() and opponent = p_other) or (challenger = p_other and opponent = auth.uid()));
$$;


-- Séries de victoires du groupe : mises gagnées d'affilée (simples et combinés).
create or replace function public.group_win_streaks(p_group uuid)
returns table (username text, streak integer)
language sql
stable
security definer
set search_path = public
as $$
    with events as (
        select s.user_id, b.resolved_at as at, s.choice_id = b.winner_choice_id as win
        from stakes s
        join bets b on b.id = s.bet_id
        where b.group_id = p_group
          and b.status = 'resolved'
        union all
        select c.user_id,
               (select max(b.resolved_at) from combo_legs l join bets b on b.id = l.bet_id where l.combo_id = c.id),
               st.status = 'won'
        from combos c
        cross join lateral combo_state(c.id) st
        where c.group_id = p_group
          and st.status in ('won', 'lost')
    ),
    ranked as (
        select user_id, win, row_number() over (partition by user_id order by at desc nulls last) as rn
        from events
    )
    select p.username,
           coalesce(min(r.rn) filter (where not r.win) - 1, count(*))::integer as streak
    from ranked r
    join profiles p on p.id = r.user_id
    where public.is_group_member(p_group)
    group by p.username
    having coalesce(min(r.rn) filter (where not r.win) - 1, count(*)) >= 3;
$$;


-- Pari validé ou annulé : les duels se règlent tout seuls.
create or replace function public.duels_on_bet_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
    v_loser uuid;
begin
    if new.status is not distinct from old.status then
        return new;
    end if;

    -- Défis sans réponse : la mise est rendue.
    if new.status in ('resolved', 'cancelled', 'closed') then
        for v_duel in select * from duels where bet_id = new.id and status = 'pending' for update loop
            perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
            update duels set status = 'expired', settled_at = now() where id = v_duel.id;
        end loop;
    end if;

    if new.status = 'resolved' then
        for v_duel in select * from duels where bet_id = new.id and status = 'active' for update loop
            if new.winner_choice_id in (v_duel.challenger_choice, v_duel.opponent_choice) then
                v_loser := case when new.winner_choice_id = v_duel.challenger_choice then v_duel.opponent else v_duel.challenger end;

                perform duel_pay(v_duel.group_id,
                                 case when v_loser = v_duel.opponent then v_duel.challenger else v_duel.opponent end,
                                 v_duel.amount * 2);

                update duels
                set status = 'won',
                    winner = case when v_loser = v_duel.opponent then v_duel.challenger else v_duel.opponent end,
                    settled_at = now()
                where id = v_duel.id;

                insert into player_notices (user_id, title, content)
                values
                    (case when v_loser = v_duel.opponent then v_duel.challenger else v_duel.opponent end,
                     '⚔️ Duel gagné !',
                     'Tu as battu ' || duel_name(v_loser) || ' sur « ' || new.question || ' » : +' || format_euros(v_duel.amount * 2) || '.'),
                    (v_loser,
                     '⚔️ Duel perdu',
                     duel_name(case when v_loser = v_duel.opponent then v_duel.challenger else v_duel.opponent end)
                     || ' a gagné votre duel sur « ' || new.question || ' ».');
            else
                -- Ni l'un ni l'autre : chacun récupère sa mise.
                perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
                perform duel_pay(v_duel.group_id, v_duel.opponent, v_duel.amount);

                update duels set status = 'draw', settled_at = now() where id = v_duel.id;

                insert into player_notices (user_id, title, content)
                select u, '⚔️ Duel nul',
                       'Aucun de vous deux n''avait le bon choix sur « ' || new.question || ' » : ta mise t''a été rendue.'
                from unnest(array[v_duel.challenger, v_duel.opponent]) u;
            end if;
        end loop;
    end if;

    if new.status = 'cancelled' then
        for v_duel in select * from duels where bet_id = new.id and status in ('active', 'won') for update loop
            if v_duel.status = 'active' then
                perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);
                perform duel_pay(v_duel.group_id, v_duel.opponent, v_duel.amount);
            else
                -- Déjà gagné : on revient à « chacun sa mise ».
                perform duel_pay(v_duel.group_id, v_duel.winner, -v_duel.amount);
                perform duel_pay(v_duel.group_id,
                                 case when v_duel.winner = v_duel.challenger then v_duel.opponent else v_duel.challenger end,
                                 v_duel.amount);
            end if;

            update duels set status = 'cancelled', settled_at = now() where id = v_duel.id;
        end loop;

        update duels set status = 'cancelled' where bet_id = new.id and status = 'draw';
    end if;

    return new;
end;
$$;

drop trigger if exists duels_on_bet_status on public.bets;
create trigger duels_on_bet_status
    after update of status on public.bets
    for each row execute function public.duels_on_bet_status();


-- Pari supprimé : les mises des duels en cours sont rendues avant la suppression.
create or replace function public.duels_on_bet_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_duel record;
begin
    for v_duel in select * from duels where bet_id = old.id and status in ('pending', 'active') loop
        perform duel_pay(v_duel.group_id, v_duel.challenger, v_duel.amount);

        if v_duel.status = 'active' then
            perform duel_pay(v_duel.group_id, v_duel.opponent, v_duel.amount);
        end if;
    end loop;

    return old;
end;
$$;

drop trigger if exists duels_on_bet_delete on public.bets;
create trigger duels_on_bet_delete
    before delete on public.bets
    for each row execute function public.duels_on_bet_delete();


grant execute on function public.duel_challenge(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.duel_answer(uuid, boolean, uuid) to authenticated;
grant execute on function public.duel_cancel(uuid) to authenticated;
grant execute on function public.my_duels(uuid) to authenticated;
grant execute on function public.duel_h2h(uuid, uuid) to authenticated;
grant execute on function public.group_win_streaks(uuid) to authenticated;
