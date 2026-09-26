# PRD — Huishoudbudget & Bouwdepot (multi-household SaaS)

## Original problem statement
Responsive web app turning the "Budget_Bouwdepot" spreadsheet into a shared household finance tool: budget dashboard, per-person split, and a full construction-deposit (bouwdepot) workflow. Each household is private; owner invites a partner; other households sign up on their own.

## Architecture
- Frontend: React (CRA/craco) + Tailwind + shadcn/ui + framer-motion + recharts. Context-based state (`AppContext`) for auth, household, language (NL/EN), theme.
- Backend: FastAPI, all routes under `/api`. Modular: `deps.py` (db + auth helpers), `auth.py` (JWT + Google session), `calc.py` (projections/split/bouwdepot rollups), `emailer.py` (Resend invite mails), `seed_data.py` (demo), `server.py` (domain routes).
- DB: MongoDB — collections: users, user_sessions, households, incomes, fixed_expenses, variable_expenses, bouwdepots, bouwposten, invoices, invites, change_log.
- Auth: email/password (JWT httpOnly cookies) AND Emergent-managed Google login (session_token). Both resolve via `get_current_user`.
- Integrations: Emergent Google Auth, JWT auth, Emergent-managed Resend (invite emails).

## User personas
- Primary: Robeson & Miraja — shared household finances + active bouwdepot.
- Secondary: other couples/households running budget and/or renovation.

## Core requirements (static)
- Private household workspace; owner invites partner; equal editors, owner-only admin actions.
- Monthly + annual dashboard (income, fixed/variable expenses, over, cumulative, savings rate; month status afgesloten/lopend/prognose).
- Per-person "wat houden we over?"; joint split 50/50 or by income, configurable per household.
- Bouwdepot cockpit + bouwposten + invoice/quote log + control checks (Controle = €0).
- Settings (categories, persons, split rule, quote statuses), change log, EUR only, NL+EN.

## Implemented (2026-06)
- Phase 1: Auth (JWT + Google), households CRUD, invites (link + email), members/roles, persons, categories, settings, change log. DONE.
- Phase 2: Fixed income + fixed/variable expenses (frequency projection), per-household split logic, dashboard monthly/annual + per-person view, bar chart. DONE.
- Phase 3: Multiple bouwdepots, bouwposten rollups, invoice/quote log, bouwdepot cockpit (6 metrics + days remaining), control checks. DONE.
- Phase 4 (partial): NL/EN language switch, dark/light theme, demo household seed, framer-motion polish. DONE.
- Verified: 19/19 backend pytest + full frontend E2E pass.

## Backlog / remaining
- P1: Row-level edit validation (Pydantic models on generic CRUD), brute-force lockout on login.
- P1: Charts — cumulative bouwdepot drawdown area chart, category pie.
- P2: Export to Excel/PDF for mortgage lender.
- P2: Bank/PSD2 auto-import (future).
- P2: Rename nav test-ids to documented convention.

## Test credentials
- robeson.constantine@gmail.com / Bouwdepot2026! (owner of demo household "Huize Constantine")
