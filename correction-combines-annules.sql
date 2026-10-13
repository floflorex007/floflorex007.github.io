-- =====================================================
-- CORRECTION DES COMBINÉS PAYÉS AVEC UN PARI ANNULÉ (2026-10-12)
-- =====================================================
--
-- À lancer APRÈS combine-annule-perdu.sql.
--
-- 1. Table player_notices : message exceptionnel pour un joueur,
--    affiché en fenêtre à sa prochaine connexion, une seule fois.
-- 2. Les combinés déjà récupérés qui contiennent un pari annulé
--    deviennent perdus : le gain est retiré du solde du groupe
--    (et du meilleur solde, qui sert aux paliers du perroquet),
--    claimed_amount passe à 0, et le joueur reçoit un message.
--
-- Relancer le script ne retire rien deux fois (claimed_amount > 0).


-- 1. Messages exceptionnels

create table if not exists public.player_notices (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    title text not null,
    content text not null,
    created_at timestamptz not null default now(),
    seen_at timestamptz
);

alter table public.player_notices enable row level security;

drop policy if exists "player_notices lecture" on public.player_notices;

create policy "player_notices lecture"
    on public.player_notices
    for select
    using (user_id = auth.uid());


create or replace function public.mark_notice_seen(p_notice uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin

    update player_notices
    set seen_at = now()
    where id = p_notice
      and user_id = auth.uid()
      and seen_at is null;

end;
$$;

grant execute on function public.mark_notice_seen(uuid) to authenticated;


-- 2. Reprise des gains

alter table public.group_members disable trigger track_best_balance;

do $$
declare
    v_combo record;
begin

    for v_combo in
        select c.id, c.user_id, c.group_id, c.stake, c.claimed_amount, g.name as group_name
        from combos c
        join groups g on g.id = c.group_id
        where c.claimed_at is not null
          and c.claimed_amount > 0
          and exists (
              select 1
              from combo_legs l
              join bets b on b.id = l.bet_id
              where l.combo_id = c.id
                and b.status = 'cancelled'
          )
        for update of c
    loop

        update group_members
        set balance = balance - v_combo.claimed_amount,
            best_balance = greatest(best_balance - v_combo.claimed_amount, balance - v_combo.claimed_amount)
        where group_id = v_combo.group_id
          and user_id = v_combo.user_id;

        update combos
        set claimed_amount = 0
        where id = v_combo.id;

        insert into player_notices (user_id, title, content)
        select
            v_combo.user_id,
            '⚖️ Correction de ton solde',
            'Un pari de ton combiné, « ' || string_agg(b.question, ' », « ') || ' », a été annulé après une contestation. '
            || 'Nouvelle règle : un pari annulé fait perdre tout le combiné qui le contient. '
            || 'Ton combiné (mise de ' || regexp_replace(replace(replace(to_char(v_combo.stake, 'FM999,999,990.00'), ',', ' '), '.', ','), ',00$', '') || ' €) est donc perdu, '
            || 'et les ' || regexp_replace(replace(replace(to_char(v_combo.claimed_amount, 'FM999,999,990.00'), ',', ' '), '.', ','), ',00$', '') || ' € qu''il t''avait rapportés '
            || 'ont été retirés de ton solde dans « ' || v_combo.group_name || ' ».'
        from combo_legs l
        join bets b on b.id = l.bet_id
        where l.combo_id = v_combo.id
          and b.status = 'cancelled';

    end loop;

end;
$$;

alter table public.group_members enable trigger track_best_balance;
