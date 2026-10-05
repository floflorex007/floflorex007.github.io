-- =========================================================
-- BETLAB : MISSIONS, POINTS ET AVANTAGES
-- À copier-coller dans Supabase > SQL Editor puis "Run".
-- Script ré-exécutable sans danger (IF NOT EXISTS / OR REPLACE).
-- Il ne touche PAS à place_bet ni resolve_bet : les missions sont
-- calculées à partir des tables stakes / bets / bet_choices existantes.
-- =========================================================


-- ---------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mission_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  mission_id text NOT NULL,
  period_key text NOT NULL,
  points integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, mission_id, period_key)
);

CREATE TABLE IF NOT EXISTS public.perk_purchases (
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  perk_id text NOT NULL,
  cost integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, perk_id)
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS equipped_badge text,
  ADD COLUMN IF NOT EXISTS username_color text,
  ADD COLUMN IF NOT EXISTS gold_frame boolean NOT NULL DEFAULT false;

-- Lecture de ses propres lignes uniquement ; toute écriture passe par les fonctions ci-dessous.
ALTER TABLE public.mission_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perk_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_claims_select_own" ON public.mission_claims;
CREATE POLICY "mission_claims_select_own" ON public.mission_claims
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "perk_purchases_select_own" ON public.perk_purchases;
CREATE POLICY "perk_purchases_select_own" ON public.perk_purchases
  FOR SELECT USING (user_id = auth.uid());


-- ---------------------------------------------------------
-- 2. CATALOGUES (points des missions, prix des avantages)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mission_catalog()
RETURNS TABLE (mission_id text, points integer, period text, target integer)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('connexion_du_jour', 10, 'day',   1),
    ('touche_a_tout',     25, 'week',  3),
    ('premier_sur_le_coup', 15, 'week', 1),
    ('assidu',            60, 'week',  5),
    ('gros_joueur',       50, 'week',  500),
    ('createur',          40, 'week',  2),
    ('premier_gain',      20, 'once',  1),
    ('outsider',          60, 'week',  1),
    ('contre_tous',       80, 'week',  1);
$$;

CREATE OR REPLACE FUNCTION public.perk_catalog()
RETURNS TABLE (perk_id text, cost integer)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('badge_novice',   50),
    ('badge_flambeur', 100),
    ('badge_stratege', 150),
    ('badge_legende',  300),
    ('cadre_dore',     150),
    ('pseudo_couleur', 60);
$$;


-- ---------------------------------------------------------
-- 3. PROGRESSION D'UNE MISSION (période en cours, fuseau Paris)
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mission_progress(p_user uuid, p_mission text)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws timestamptz := date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  result numeric := 0;
BEGIN
  IF p_mission = 'connexion_du_jour' THEN
    result := 1;

  ELSIF p_mission = 'touche_a_tout' THEN
    SELECT count(DISTINCT bet_id) INTO result
    FROM stakes WHERE user_id = p_user AND created_at >= ws;

  ELSIF p_mission = 'premier_sur_le_coup' THEN
    -- premier à miser sur le pari de quelqu'un d'autre, dans l'heure qui suit sa création
    SELECT count(*) INTO result
    FROM stakes s
    JOIN bets b ON b.id = s.bet_id
    WHERE s.user_id = p_user
      AND s.created_at >= ws
      AND b.author_id IS DISTINCT FROM p_user
      AND s.created_at <= b.created_at + interval '1 hour'
      AND s.created_at = (SELECT min(s2.created_at) FROM stakes s2 WHERE s2.bet_id = s.bet_id);

  ELSIF p_mission = 'assidu' THEN
    SELECT count(DISTINCT (created_at AT TIME ZONE 'Europe/Paris')::date) INTO result
    FROM stakes WHERE user_id = p_user AND created_at >= ws;

  ELSIF p_mission = 'gros_joueur' THEN
    SELECT coalesce(sum(stake), 0) INTO result
    FROM stakes WHERE user_id = p_user AND created_at >= ws;

  ELSIF p_mission = 'createur' THEN
    SELECT count(*) INTO result
    FROM bets WHERE author_id = p_user AND created_at >= ws;

  ELSIF p_mission = 'premier_gain' THEN
    SELECT count(*) INTO result
    FROM stakes s JOIN bets b ON b.id = s.bet_id
    WHERE s.user_id = p_user AND b.winner_choice_id = s.choice_id;

  ELSIF p_mission = 'outsider' THEN
    -- gain sur une cote >= 3 (mise placée cette semaine)
    SELECT count(*) INTO result
    FROM stakes s
    JOIN bets b ON b.id = s.bet_id AND b.winner_choice_id = s.choice_id
    JOIN bet_choices c ON c.id = s.choice_id
    WHERE s.user_id = p_user AND s.created_at >= ws AND c.odds >= 3;

  ELSIF p_mission = 'contre_tous' THEN
    -- gain en ayant misé avec la minorité (<= 25 % des mises, pari à >= 4 parieurs)
    SELECT count(*) INTO result
    FROM stakes s
    JOIN bets b ON b.id = s.bet_id AND b.winner_choice_id = s.choice_id
    WHERE s.user_id = p_user AND s.created_at >= ws
      AND (SELECT count(DISTINCT user_id) FROM stakes WHERE bet_id = s.bet_id) >= 4
      AND (SELECT count(DISTINCT user_id) FROM stakes WHERE bet_id = s.bet_id AND choice_id = s.choice_id)::numeric
          / (SELECT count(DISTINCT user_id) FROM stakes WHERE bet_id = s.bet_id) <= 0.25;
  END IF;

  RETURN coalesce(result, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.mission_period_key(p_period text)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE p_period
    WHEN 'day'  THEN to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
    WHEN 'week' THEN to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYY-"S"IW')
    ELSE 'once'
  END;
$$;


-- ---------------------------------------------------------
-- 4. ÉTAT COMPLET POUR L'INTERFACE
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_missions_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  earned integer;
  spent integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non connecté.';
  END IF;

  SELECT coalesce(sum(points), 0) INTO earned FROM mission_claims WHERE user_id = uid;
  SELECT coalesce(sum(cost), 0)   INTO spent  FROM perk_purchases WHERE user_id = uid;

  RETURN jsonb_build_object(
    'points', earned - spent,
    'earned', earned,
    'missions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', m.mission_id,
        'points', m.points,
        'period', m.period,
        'target', m.target,
        'progress', least(mission_progress(uid, m.mission_id), m.target),
        'claimed', EXISTS (
          SELECT 1 FROM mission_claims c
          WHERE c.user_id = uid AND c.mission_id = m.mission_id
            AND c.period_key = mission_period_key(m.period)
        )
      )), '[]'::jsonb)
      FROM mission_catalog() m
    ),
    'perks', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.perk_id,
        'cost', p.cost,
        'owned', EXISTS (SELECT 1 FROM perk_purchases b WHERE b.user_id = uid AND b.perk_id = p.perk_id)
      )), '[]'::jsonb)
      FROM perk_catalog() p
    )
  );
END;
$$;


-- ---------------------------------------------------------
-- 5. RÉCLAMER UNE MISSION
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_mission(p_mission text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  m record;
  inserted integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non connecté.';
  END IF;

  SELECT * INTO m FROM mission_catalog() WHERE mission_id = p_mission;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission inconnue.';
  END IF;

  IF mission_progress(uid, p_mission) < m.target THEN
    RAISE EXCEPTION 'Mission pas encore accomplie.';
  END IF;

  INSERT INTO mission_claims (user_id, mission_id, period_key, points)
  VALUES (uid, p_mission, mission_period_key(m.period), m.points)
  ON CONFLICT (user_id, mission_id, period_key) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN
    RAISE EXCEPTION 'Mission déjà réclamée.';
  END IF;

  RETURN m.points;
END;
$$;


-- ---------------------------------------------------------
-- 6. ACHETER ET ÉQUIPER UN AVANTAGE
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buy_perk(p_perk text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  price integer;
  balance_pts integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non connecté.';
  END IF;

  SELECT cost INTO price FROM perk_catalog() WHERE perk_id = p_perk;
  IF price IS NULL THEN
    RAISE EXCEPTION 'Avantage inconnu.';
  END IF;

  IF EXISTS (SELECT 1 FROM perk_purchases WHERE user_id = uid AND perk_id = p_perk) THEN
    RAISE EXCEPTION 'Avantage déjà acheté.';
  END IF;

  SELECT (SELECT coalesce(sum(points), 0) FROM mission_claims WHERE user_id = uid)
       - (SELECT coalesce(sum(cost), 0) FROM perk_purchases WHERE user_id = uid)
  INTO balance_pts;

  IF balance_pts < price THEN
    RAISE EXCEPTION 'Pas assez de points.';
  END IF;

  INSERT INTO perk_purchases (user_id, perk_id, cost) VALUES (uid, p_perk, price);
END;
$$;

-- p_value : badge -> 'on' / 'off' ; cadre_dore -> 'on' / 'off' ; pseudo_couleur -> '#rrggbb' ou 'off'
CREATE OR REPLACE FUNCTION public.equip_perk(p_perk text, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  badge_label text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non connecté.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM perk_purchases WHERE user_id = uid AND perk_id = p_perk) THEN
    RAISE EXCEPTION 'Avantage non possédé.';
  END IF;

  IF p_perk LIKE 'badge\_%' THEN
    badge_label := CASE p_perk
      WHEN 'badge_novice'   THEN '🎲 Novice'
      WHEN 'badge_flambeur' THEN '🔥 Flambeur'
      WHEN 'badge_stratege' THEN '🧠 Stratège'
      WHEN 'badge_legende'  THEN '👑 Légende'
    END;
    UPDATE profiles SET equipped_badge = CASE WHEN p_value = 'off' THEN NULL ELSE badge_label END
    WHERE id = uid;

  ELSIF p_perk = 'cadre_dore' THEN
    UPDATE profiles SET gold_frame = (p_value = 'on') WHERE id = uid;

  ELSIF p_perk = 'pseudo_couleur' THEN
    IF p_value <> 'off' AND p_value !~ '^#[0-9a-fA-F]{6}$' THEN
      RAISE EXCEPTION 'Couleur invalide.';
    END IF;
    UPDATE profiles SET username_color = CASE WHEN p_value = 'off' THEN NULL ELSE p_value END
    WHERE id = uid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_missions_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_perk(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equip_perk(text, text) TO authenticated;

-- Fonction interne : pas d'appel direct possible (elle accepte un utilisateur arbitraire)
REVOKE EXECUTE ON FUNCTION public.mission_progress(uuid, text) FROM PUBLIC, anon, authenticated;
