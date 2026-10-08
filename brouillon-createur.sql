-- =========================================================
-- BetLab : un pari est publié quand son créateur a misé dessus
--
-- À lancer dans le SQL Editor (« Run and enable RLS »),
-- ou par Claude via le terminal. À lancer après
-- createur-peut-miser.sql.
--
--   1. Un pari créé commence en « brouillon » (status = 'draft') :
--      seul son créateur le voit (ni carte, ni direct, ni choix
--      chez les autres).
--   2. La mise du créateur (place_bet) le publie : il passe
--      « ouvert » et sa date de création devient l'heure de
--      publication (mise max et clôture repartent de là).
--   3. Personne d'autre ne peut miser sur un brouillon, et un
--      brouillon ne peut pas être validé.
--   4. delete_draft_bet : le créateur supprime son brouillon.
--      Ses brouillons dont l'échéance est passée sont supprimés
--      tout seuls quand il crée un nouveau pari.
--
-- Les paris déjà ouverts ne sont pas touchés.
-- Côté site : renderDraftCard() dans app.js (la mise passe par
-- la fenêtre de mise habituelle).
-- =========================================================


-- ---------------------------------------------------------
-- 1. Nouvel état « brouillon »
-- ---------------------------------------------------------

alter table public.bets drop constraint if exists bets_status_check;

alter table public.bets add constraint bets_status_check
    check (status = any (array['draft', 'open', 'closed', 'resolved', 'cancelled']));


-- Un pari créé est toujours un brouillon, sans gagnant,
-- à l'heure du serveur (impossible de publier sans miser).

create or replace function public.bets_start_as_draft()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    new.created_at := now();
    new.status := 'draft';
    new.winner_choice_id := null;

    -- Ménage : brouillons oubliés du même créateur, échéance passée.
    delete from bets
    where author_id = new.author_id
      and status = 'draft'
      and deadline_at is not null
      and deadline_at <= now();

    return new;

end;
$$;

drop trigger if exists bets_start_as_draft on public.bets;

create trigger bets_start_as_draft
    before insert on public.bets
    for each row
    execute function public.bets_start_as_draft();


-- Un brouillon ne peut que devenir « ouvert » (par la mise du créateur).

create or replace function public.bets_draft_guard()
returns trigger
language plpgsql
as $$
begin

    if old.status = 'draft' and new.status not in ('draft', 'open') then
        raise exception 'Ce pari n''est pas encore publié : son créateur doit d''abord miser dessus.';
    end if;

    return new;

end;
$$;

drop trigger if exists bets_draft_guard on public.bets;

create trigger bets_draft_guard
    before update on public.bets
    for each row
    execute function public.bets_draft_guard();


-- ---------------------------------------------------------
-- 2. Les autres ne voient pas les brouillons
--    (les choix et mises suivent : leurs règles passent par bets)
-- ---------------------------------------------------------

drop policy if exists bets_select_group on public.bets;

create policy bets_select_group on public.bets
    for select
    using (
        is_group_member(group_id)
        and (status <> 'draft' or author_id = auth.uid())
    );


-- ---------------------------------------------------------
-- 3. place_bet : la mise du créateur publie son brouillon
--    (reprise de createur-peut-miser.sql)
-- ---------------------------------------------------------

create or replace function public.place_bet(p_choice_id uuid, p_stake numeric)
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


-- ---------------------------------------------------------
-- 4. Supprimer son brouillon
-- ---------------------------------------------------------

create or replace function public.delete_draft_bet(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    delete from bets
    where id = p_bet_id
      and author_id = auth.uid()
      and status = 'draft';

    if not found then
        raise exception 'Brouillon introuvable (déjà publié ou supprimé ?).';
    end if;

end;
$$;

grant execute on function public.delete_draft_bet(uuid) to authenticated;
