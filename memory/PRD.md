# PRD — Huishoudbudget & Bouwdepot (multi-household SaaS)

## Original problem statement
Responsive web app turning the "Budget_Bouwdepot" spreadsheet into a shared household finance tool: budget dashboard, per-person split, construction-deposit (bouwdepot) workflow. Private per household, owner invites partner.

## Architecture
- Frontend: React (CRA/craco) + Tailwind + shadcn/ui + framer-motion + recharts. Context-based state (AppContext) for auth, household, language (NL/EN), theme.
- Backend: FastAPI, routes under /api. Modules: deps.py (db+auth), auth.py (JWT + Google session), calc.py (projections/split/bouwdepot/pots), emailer.py (Resend invites), export.py (Excel/PDF), llm.py (Claude via Emergent key), seed_data.py, server.py.
- DB: MongoDB. Collections: users, user_sessions, households, incomes, fixed_expenses, variable_expenses, bouwdepots, bouwposten, invoices, pots, projects, project_items, invites, change_log, ai_messages.
- Integrations: JWT auth, Emergent-managed Google auth, Emergent Resend (invites), Claude (claude-sonnet-4-6 via EMERGENT_LLM_KEY).

## User personas
- Primary: Robeson & Miraja — shared finances + active bouwdepot.
- Secondary: other couples/households running budget and/or renovation.

## Core requirements (static)
- Private household; owner invites partner; equal editors, owner-only admin.
- Monthly+annual dashboard (income, fixed/variable, over, cumulative, savings rate; month status).
- Per-person "wat houden we over?"; joint split 50/50 or by income (per household).
- Bouwdepot cockpit + bouwposten + invoice/quote log + control checks. EUR, NL+EN, change log.

## Implemented (dates)
- 2026-06 v1: Auth (JWT+Google), households/invites/roles, settings/categories/persons, income+fixed/variable expenses, split logic + projections, dashboard + per-person, bouwdepot (bouwposten/invoices/tracker/control checks), demo household, NL/EN, dark/light. Tested 19/19 backend + full FE.
- 2026-06 v2: Bouwdepot drawdown chart (actual+forecast), Excel+PDF export, smart warnings (budget_near/overrun/depot_low), dashboard category pie + monthly savings chart, Projecten & Sparen (savings goals with required-monthly + feasibility). Tested 7/7 + FE.
- 2026-06 v3: Claude AI assistant (floating chat), AI dashboard insights card, AI auto-categorize in variable-expense dialog; Potjes (envelope budgeting, carryover, category-linked, manual + auto-distribute); termijnfacturen (installments linked to a quote, due date, expected vs paid). Tested 6/6 backend + full FE E2E pass.

## Backlog / remaining
- P1: brute-force lockout on login; Pydantic validation on generic CRUD.
- P1: per-pot monthly contribution tracking to auto-grow project progress; markers on drawdown chart.
- P2: recurring monthly AI email report; per-category monthly budget alerts.
- P2: bank/PSD2 auto-import (future); streaming AI responses (currently non-streaming).

## Test credentials
- robeson.constantine@gmail.com / Bouwdepot2026! (owner of demo household "Huize Constantine", year 2026)
