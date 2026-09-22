-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text NOT NULL DEFAULT ''::text UNIQUE,
  balance numeric NOT NULL DEFAULT '1000'::numeric CHECK (balance >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.bets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question text NOT NULL,
  author_id uuid,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'closed'::text, 'resolved'::text])),
  created_at timestamp with time zone DEFAULT now(),
  winner_choice_id uuid,
  CONSTRAINT bets_pkey PRIMARY KEY (id),
  CONSTRAINT bets_winner_choice_id_fkey FOREIGN KEY (winner_choice_id) REFERENCES public.bet_choices(id),
  CONSTRAINT bets_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.bet_choices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bet_id uuid NOT NULL,
  label text NOT NULL,
  odds numeric NOT NULL CHECK (odds > 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bet_choices_pkey PRIMARY KEY (id),
  CONSTRAINT bet_choices_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES public.bets(id)
);
CREATE TABLE public.stakes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bet_id uuid NOT NULL,
  choice_id uuid NOT NULL,
  user_id uuid NOT NULL,
  stake numeric NOT NULL CHECK (stake > 0::numeric),
  potential_win numeric NOT NULL CHECK (potential_win >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT stakes_pkey PRIMARY KEY (id),
  CONSTRAINT stakes_bet_id_fkey FOREIGN KEY (bet_id) REFERENCES public.bets(id),
  CONSTRAINT stakes_choice_id_fkey FOREIGN KEY (choice_id) REFERENCES public.bet_choices(id),
  CONSTRAINT stakes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);