-- =========================================================
-- BetLab : paris en direct (Supabase Realtime)
--
-- Active les notifications en direct sur les paris, leurs choix
-- et les mises. La sécurité (RLS) s'applique : un joueur ne reçoit
-- que les événements des groupes dont il est membre.
-- À lancer une seule fois.
-- =========================================================

do $$
begin

    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bets') then
        alter publication supabase_realtime add table public.bets;
    end if;

    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bet_choices') then
        alter publication supabase_realtime add table public.bet_choices;
    end if;

    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stakes') then
        alter publication supabase_realtime add table public.stakes;
    end if;

end;
$$;
