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
- 2026-06 v4: (superseded) Categorie-budget per uitgavecategorie — later vervangen door potje-gedreven budget (zie v5).
- 2026-06 v5:
  - Refresh/onboarding-race fix: `ready`-vlag in AppContext gate't de onboarding-redirect (geen bounce naar /onboarding meer bij verversen).
  - Potjes verrekend in dashboard-overschot: Overschot-KPI toont "gereserveerd in potjes" + "vrij na potjes" (maand+jaar); spaargrafiek 2e lijn "Vrij na potjes"; potjes-overzicht op dashboard; maandentabel kolommen Potjes + Vrij na potjes; Cumulatief rekent na-potjes.
  - Bouwdepot dubbeltel-fix: `still_to_submit` per geaccepteerde offerte vermindert met gekoppelde termijnfacturen (ingediend/betaald) → "vrij besteedbaar" blijft stabiel bij toevoegen termijn. Geen statuswijziging.
  - Budget uit potjes: los categorie-budget verwijderd; dashboard toont per potje "besteed deze maand vs. maandbedrag" + over-budget banner; AI-context beschrijft potjes-budget.
  - MERGE Potjes + Projecten → één tab "Doelen & Sparen" (/doelen). Een doel = pot met optioneel target_date + kostenposten + already_saved. Doorlopend potje (categorie-envelop) of project-type (kostenposten → doelbedrag, required-monthly, haalbaarheid). Backend compute_goals_summary + /goals-summary; migratie projects→pots (idempotent). Nav + dashboard hernoemd. Tested 7/7 backend + full FE E2E.
- 2026-06 v6 (doelen-uitbreiding):
  - Voltooid-melding: compute_goals_summary geeft `completed` (saldo ≥ doelbedrag) + `date_passed`; Doelen-scherm toont "Doel behaald! 🎉"-badge.
  - AI-tip per doel: POST /households/{hid}/goals/{pot_id}/tip (Claude) → felicitatie/vervolgtip; knop + weergave op de kaart.
  - Slim verdelen: POST /households/{hid}/goals/distribute verdeelt het maandelijkse overschot — project-doelen (op streefdatum gesorteerd) krijgen hun required-monthly, doorlopende potjes de rest gelijk verdeeld; "Verdeel overschot"-knop op /doelen.
  - Export: PDF + Excel tonen nu "Doelen & Sparen" (type, streefdatum, saldo, per maand, nog nodig, haalbaar) i.p.v. losse Projecten. Backend curl + FE screenshot geverifieerd.

## Backlog / remaining
- P1: brute-force lockout on login; Pydantic validation on generic CRUD.
- P2: recurring monthly AI email report; bank/PSD2 auto-import; streaming AI responses.
- P3 (cosmetic): silence Recharts ResponsiveContainer zero-size warning; add DialogDescription/aria-describedby for a11y; purge stale legacy `category_budgets` field from household docs.

## Test credentials
- robeson.constantine@gmail.com / Bouwdepot2026! (owner of demo household "Huize Constantine", year 2026)
