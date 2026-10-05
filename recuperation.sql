-- =========================================================
--   BETLAB : RÉCUPÉRATION MANUELLE DES GAINS
--   À coller dans Supabase → SQL Editor → Run.
--   Le script peut être relancé sans risque.
--
--   Avant : valider un pari payait directement les gagnants.
--   Maintenant : valider un pari fixe juste le résultat ;
--   chaque parieur doit ensuite cliquer sur la carte du pari
--   (« Récupérer » ou « Perdre la mise ») pour solder sa mise.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Date à laquelle la mise a été récupérée (gagnée ou perdue).
-- ---------------------------------------------------------

alter table public.stakes
    add column if not exists claimed_at timestamptz;

create table if not exists public.app_settings (
    key text primary key,
    value timestamptz
);


-- Les paris déjà validés ont déjà été payés avec l'ancien système :
-- leurs mises sont considérées comme récupérées.
update public.stakes s
set claimed_at = now()
from public.bets b
where b.id = s.bet_id
  and b.status = 'resolved'
  and s.claimed_at is null
  and not exists (
      select 1 from public.app_settings
      where key = 'manual_claims_since'
  );

-- Marque la date de passage au nouveau système
-- (pour que la mise à jour précédente ne s'applique qu'une fois).
insert into public.app_settings (key, value)
values ('manual_claims_since', now())
on conflict (key) do nothing;


-- ---------------------------------------------------------
-- 2. Valider un pari : fixe le résultat, SANS payer.
--    Réservé au créateur du pari (ou à l'admin).
-- ---------------------------------------------------------

drop function if exists public.resolve_bet(uuid, uuid);

create function public.resolve_bet(p_bet_id uuid, p_winner_choice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
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

grant execute on function public.resolve_bet(uuid, uuid) to authenticated;


-- ---------------------------------------------------------
-- 3. Récupérer ses mises sur un pari validé.
--    Gagné : le gain est ajouté au solde.
--    Perdu : la mise est simplement soldée.
--    Renvoie le montant gagné (0 si perdu).
-- ---------------------------------------------------------

create or replace function public.claim_bet(p_bet_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid := auth.uid();
    v_winner uuid;
    v_status text;
    v_total numeric := 0;
    v_count integer;
begin

    if v_user is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    select status, winner_choice_id into v_status, v_winner
    from bets
    where id = p_bet_id;

    if v_status is distinct from 'resolved' then
        raise exception 'Ce pari n''est pas encore validé.';
    end if;

    -- Verrouille le profil pour éviter deux récupérations simultanées.
    perform 1 from profiles where id = v_user for update;

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
        update profiles
        set balance = balance + v_total
        where id = v_user;
    end if;

    return v_total;

end;
$$;

grant execute on function public.claim_bet(uuid) to authenticated;
