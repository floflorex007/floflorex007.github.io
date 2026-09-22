# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BetLab is a static, framework-free demo web app for placing fictional bets between users (no real money). There is no build step, no bundler, and no package.json — it's plain HTML/CSS/JS served directly, backed by Supabase (Postgres + Auth) as a hosted backend.

## Running it

There is no dev server or build command. Open `Index.html` (login/register) directly in a browser, or serve the folder with any static file server. `app.html` is the main SPA the user lands on after login. There are no tests or linters configured.

## Architecture

- `Index.html` — login/register page, posts to `app.js` auth functions, redirects to `app.html` on success.
- `app.html` — single-page app shell: one `<section class="app-page">` per "page" (bets list, my bets, my created bets, create bet), toggled via `showPage()` in `app.js` rather than real navigation. Two `<div class="modal">` elements (place-bet modal, resolve-bet modal) are shown/hidden the same way.
- `app.js` — all logic lives in this one file (~2100 lines), organized top-to-bottom by numbered comment sections: config, globals, utilities, auth, profile/balance, load bets, display bets, place bet, my bets, my created bets, resolve bet, create bet, page navigation, logout, init. There is no module system — everything is a top-level function/global, and `initAuthPage()` / `initAppPage()` wire up DOM event listeners depending on which HTML page loaded the script.
- `style.css` — all styling, single file.
- `Supabase.sql` — reference schema only (per its own header comment: "not meant to be run", constraints may not be exhaustive). Source of truth for table/column shapes when writing Supabase queries.

## Supabase specifics

- Client is created directly in `app.js` with a hardcoded `SUPABASE_URL` and publishable `SUPABASE_KEY` — this is expected for this front-only demo, not a bug to "fix" by moving to env vars (there's no build step to inject them).
- Auth is username-based in the UI, but Supabase Auth requires an email. `usernameToEmail()` converts `identifiant` → `identifiant@betlab.test` so the rest of the app can pretend usernames are the login credential. Never bypass this shim when touching auth code.
- Data model (see `Supabase.sql`):
  - `profiles` — one row per auth user, holds fictional `balance` (default 1000), FK'd to `auth.users`.
  - `bets` — a question with `status` (`open` / `closed` / `resolved`) and optional `winner_choice_id`.
  - `bet_choices` — the possible outcomes of a bet, each with its own `odds`.
  - `stakes` — a user's wager on one `bet_choices` row, storing `stake` and precomputed `potential_win`.
- `getBets()` shows the pattern used throughout the file for joined reads: `supabaseClient.from("bets").select("*, bet_choices!bet_choices_bet_id_fkey (*)")`. Follow this pattern for other joined queries rather than doing N+1 fetches.
- Resolving a bet (`resolveBet()`) sets the winner and is expected to pay out matching `stakes` — when touching payout logic, keep balance updates and bet/stake status changes consistent (this is a demo, so there's no DB-level transaction/RPC enforcing it; it's done client-side).

## Conventions in this codebase

- Heavy vertical whitespace and one-attribute-per-line HTML formatting is the existing style in `Index.html`/`app.html` — match it rather than compacting markup.
- French is used throughout: UI copy, comment section headers, and error messages. Keep new user-facing strings and comments in French for consistency.
- `escapeHtml()` is used before interpolating any user-provided text (bet questions, choice labels, usernames) into innerHTML. Always use it for new dynamic HTML rather than raw template interpolation.
