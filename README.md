# Shopping Assistant

AI clothing purchase assistant MVP.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## What Works

- Mobile-first onboarding/profile editing
- Preference selection with future-ready weighted data
- URL analysis flow with loading states
- Mock product parser and manual fallback parser
- Deterministic material evaluation, preference matching, scoring, size confidence, and care guide
- Local analysis history through a repository layer backed by `localStorage`
- Unit tests for core domain logic

## Mock Boundaries

- External shopping mall scraping is mocked by `MockProductParser`.
- Manual paste parsing is intentionally lightweight and designed as a replaceable adapter.
- Product images use public demo imagery.

## Next Steps

- Add a server-side scraping or extraction route behind the parser interface.
- Add AI extraction for inconsistent product pages.
- Move profile/history repositories to Supabase or Postgres.
- Add authentication and cross-device sync.
- Add product comparison using the normalized `ProductFacts` and `AnalysisResult` shapes.
