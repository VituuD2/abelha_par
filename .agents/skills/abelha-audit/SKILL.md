---
name: abelha-audit
description: Full-stack audit-and-fix workflow for the abelha_par / scanner-checkout app (Next 15 App Router, React 19, TypeScript, Supabase with RLS, Olist/Tiny, Nuvemshop, Yampi, ABC analytics). Use whenever the user asks to review, audit, find bugs, check security, harden, find structural or backend problems, or "analyze the whole app", even if they do not say "audit". Finds user-facing bugs, backend/API/auth/integration risks and structural problems, reports them by severity, then fixes the safe ones with minimal diffs and verifies.
---

# abelha-audit

Audit first, fix second, verify always. Never refactor for taste. Every finding must cite
`file:line` and a concrete failure scenario. No evidence, no finding.

## 0. Scope (decide before reading code)
- If the user named an area (scanner, ninho, analytics, auth, integrations, db), audit ONLY that area.
- If the user said "whole app", go area by area in the order below, one area at a time,
  and write the findings of each area before moving to the next (keeps context small).
- Do NOT read: src/lib/analytics/data/*.json, .next/, package-lock.json, .env*, root test-*.ts, check-db.ts.
  (If a root test-*.ts file is needed, open only its first 15 lines and never print secrets.)

## 1. Baseline (always, cheap)
Run and record results: `npm run typecheck`, `npm run lint`, `npm test`.
Existing failures are findings. Do not "fix" by silencing rules or deleting tests.

## 2. Audit areas (checklist, check only what applies)

### A. Auth, access, middleware (HIGH priority)
- src/middleware.ts: matcher covers every protected page and /api route; public routes are an explicit allowlist.
- Every route.ts in src/app/api validates the session/permission itself (lib/auth, access, page-access,
  permissions, session-access). Middleware alone is not enough.
- /api/internal/* (analytics-sync, olist-sync, olist-token-refresh): protected by a secret/cron check; fails closed if the env var is missing.
- Password reset / forgot-password / login: no user enumeration, no open redirect in callback `next`/redirect params.
- Supabase admin (service role) client used only server-side; never imported from client components or hooks.
- Roles/permissions checked server-side, not only hidden in the UI.

### B. Supabase / database
- RLS enabled on every table the app touches; policies match the owner/team model used in code.
- Queries scoped by owner/user; no query relies on the client sending ownerId.
- Migrations in supabase/ are additive and idempotent; flag destructive changes, missing indexes on filtered/joined columns, N+1 loops over rows.
- Unbounded selects (no limit/pagination) on orders, batches, sessions, history.
- Use the installed Supabase skill for current Supabase/RLS/auth guidance before changing policies.

### C. Integrations (Olist/Tiny, Nuvemshop, Yampi)
- Webhook /api/webhooks/olist/[ownerId]/[signature]: signature verified with constant-time compare, before any DB write; replay/duplicate delivery is idempotent.
- OAuth: state generated and validated (tiny-oauth-state), callback handles denial/error, tokens stored encrypted (token-crypto), never logged or sent to the client.
- Token refresh: handles expiry, concurrent refresh, and failure without wiping a good token.
- Every outbound call has a timeout (request-timeouts), retry/backoff on 429/5xx (rate-limit), and user-safe error messages.
- Pagination of external lists is complete (no silent truncation); partial sync failures are surfaced, not swallowed.
- Error responses never leak upstream bodies, tokens or stack traces.

### D. Scanner and reconciliation flow (core user value)
- Rapid / duplicate scans, double Enter, scanner firing keystrokes into other inputs (scanner-input-guard, use-scanner).
- Scan session state: race between optimistic store (scan-store) and server (scan-session-server); two tabs or two operators on the same batch; reload mid-session.
- matcher/order-id/order-reference: normalization (case, whitespace, leading zeros, prefixes), ambiguous matches, not-found and already-scanned paths.
- Reconciliation: counts always add up; completed batches cannot be re-opened or double-counted; tracking-refresh does not overwrite newer data.
- Audio/popups/focus: input regains focus after popups; no stuck modal; keyboard-only operation works.
- Loading/empty/error states exist for every fetch (a blank or stuck screen is a user-facing bug).

### E. Analytics (ABC / Pareto)
- Sync idempotent (re-run does not duplicate); long syncs respect the platform time limit (check vercel.json maxDuration); progress and failure states reach the UI.
- Division by zero / empty dataset / missing cost handled; totals and percentages consistent between table, chart and export.
- Export (exceljs/xlsx) streams or caps size; formula injection: cell values starting with = + - @ are escaped.
- Large JSON catalogs loaded lazily and only server-side.

### F. Frontend / structural
- Client/server boundary: no server-only module or secret imported in a "use client" file.
- Hooks: effect dependencies, missing cleanup (timers, listeners, audio), stale closures.
- Duplicate logic across lib/ files (olist.ts vs analytics/olist-client.ts, scan-session.ts vs scan-session-server.ts): flag divergence risks, do not merge unless asked.
- Accessibility basics on core flows: labels, focus order, contrast, touch targets on mobile.
- Dependency/config hygiene: version mismatches (e.g. eslint-config-next vs next major), `.next/` tracked in git, unused deps, committed credentials in the repo or git history (report path only, never print the value, recommend rotation).

## 3. Severity
- P0: data loss/leak, auth bypass, secret exposure, wrong order matched/shipped.
- P1: user-visible breakage, crash, stuck flow, silent integration failure.
- P2: robustness, performance, structural debt with a concrete risk.
- P3: polish. Report in one line each; do not fix unless asked.

## 4. Report format (write this BEFORE fixing; keep it short)
For each finding: `ID | P# | file:line | what breaks and for whom | proposed fix (1 line)`.
End with a table: counts per severity, and which will be fixed now vs need a decision.

## 5. Fix policy
- Fix P0/P1 and clearly-safe P2 now, one finding per small commit-sized change, minimal diff, existing style.
- Ask before: schema/RLS/migration changes, auth model changes, dependency changes, deleting files, rotating or touching credentials, changing public API response shapes.
- Never change behavior of the integration contracts (webhook URL shape, OAuth callbacks) without asking.
- Add or extend a test in tests/*.test.cjs when the fix is in pure logic (matcher, order-id, reconciliation, analytics math).
- After each fix batch: `npm run typecheck && npm run lint && npm test`. If red, fix or revert that change.

## 6. Final reply (short)
Changed files, findings fixed (IDs), findings left open and why, and the exact verification commands that passed.
No narration of the process.
