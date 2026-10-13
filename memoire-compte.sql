-- =========================================================
-- BetLab : verdicts vus et niveau débloqué retenus par compte (2026-10-13)
--
-- Avant, c'était seulement dans le navigateur (localStorage) : sur un autre
-- appareil, ou à une autre adresse du site, le verdict d'une contestation se
-- rejouait et « Débloquer le niveau » revenait pour un niveau déjà débloqué.
--
--   - profiles.claimed_level : dernier niveau débloqué (bouton violet) ;
--     set_claimed_level(p_level) ne fait que monter (sauf p_reset).
--   - contest_verdicts_seen : verdicts déjà vus par le joueur ;
--     mark_verdict_seen(p_bet_id). Lecture : ses propres lignes (RLS).
-- Le site garde aussi le navigateur, et prend le plus avancé des deux.
-- =========================================================


alter table public.profiles
    add column if not exists claimed_level integer;


drop function if exists public.set_claimed_level(integer);

-- p_reset : l'XP a été remise à zéro (app_settings.xp_reset_at), le niveau
-- débloqué redescend avec elle.
create or replace function public.set_claimed_level(p_level integer, p_reset boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    update profiles
    set claimed_level = case
            when p_reset then p_level
            else greatest(coalesce(claimed_level, 0), p_level)
        end
    where id = auth.uid();

end;
$$;

grant execute on function public.set_claimed_level(integer, boolean) to authenticated;


create table if not exists public.contest_verdicts_seen (
    user_id uuid not null references public.profiles(id) on delete cascade,
    bet_id uuid not null references public.bets(id) on delete cascade,
    seen_at timestamptz not null default now(),
    primary key (user_id, bet_id)
);

alter table public.contest_verdicts_seen enable row level security;

drop policy if exists "contest_verdicts_seen lecture" on public.contest_verdicts_seen;

create policy "contest_verdicts_seen lecture"
    on public.contest_verdicts_seen
    for select
    using (user_id = auth.uid());


create or replace function public.mark_verdict_seen(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    if auth.uid() is null then
        raise exception 'Utilisateur non connecté.';
    end if;

    insert into contest_verdicts_seen (user_id, bet_id)
    values (auth.uid(), p_bet_id)
    on conflict do nothing;

end;
$$;

grant execute on function public.mark_verdict_seen(uuid) to authenticated;
