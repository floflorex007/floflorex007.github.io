-- =========================================================
--   BETLAB : NOUVEAU DÉPART (points + missions + XP)
--   À coller dans Supabase → SQL Editor → Run,
--   APRÈS avoir relancé missions.sql puis animations.sql.
--
--   ⚠️ Irréversible. L'admin garde ses points et ses missions
--   (mais son XP repart aussi de zéro).
--   Relancer ce script refait une réinitialisation complète
--   à la date du moment.
-- =========================================================


-- 1. Date de réinitialisation : seules les mises et les paris
--    faits après ce moment comptent pour les missions.

insert into public.app_settings (key, value)
values ('missions_reset_at', now())
on conflict (key) do update set value = excluded.value;


-- 1 bis. XP : seules les mises faites après ce moment comptent
--    (s'applique à tout le monde, admin compris).

insert into public.app_settings (key, value)
values ('xp_reset_at', now())
on conflict (key) do update set value = excluded.value;


-- 2. Missions déjà récupérées : effacées.

delete from public.mission_claims
where user_id in (
    select id from public.profiles where not is_admin
);


-- 3. Points remis à zéro.

select set_config('betlab.allow_points', 'on', false);

update public.profiles
set points = 0
where not is_admin;

select set_config('betlab.allow_points', 'off', false);
