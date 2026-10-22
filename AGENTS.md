# scanner-checkout (abelha_par)

Next 15 App Router, React 19, TS, Tailwind v4, Supabase (RLS), zustand.
Domain: order scanner/checkout + Olist/Tiny, Nuvemshop, Yampi integrations + ABC analytics.

## Map
- Scanner: src/hooks/use-scanner.ts, src/stores/scan-store.ts, src/lib/{scan-session*,matcher,scanner-input-guard}.ts
- Olist/Tiny: src/lib/{olist*,tiny-*,token-crypto}.ts | Others: src/lib/{nuvemshop,yampi}.ts
- Reconciliation/tracking: src/lib/{reconciliation*,tracking*,batch-orders}.ts
- Analytics: src/lib/analytics/*, src/components/analytics/*
- Auth/access: src/middleware.ts, src/lib/{auth,access,page-access,permissions}.ts, src/lib/supabase/*
- API routes: src/app/api/**/route.ts | DB migrations: supabase/

## Rules
- Minimal diffs. No unrelated refactors. No new deps without asking.
- Patch only needed lines; never rewrite whole files.
- Reuse existing components/lib helpers before creating new ones.
- Never expose service keys or tokens client-side; never print secrets.
- DB changes: migration in supabase/ + consider RLS.
- Final reply: changed files + one-line result. No explanations unless asked.

## Verify
npm run typecheck && npm run lint && npm test

## Do not read unless asked
src/lib/analytics/data/*.json, .next/, package-lock.json, root test-*.ts, check-db.ts, .env*