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
- URL analysis flow with loading, failure, and manual fallback states
- Server-side URL analysis route with SSRF guardrails
- JSON-LD, meta tag, and page text extraction into normalized product data
- Replaceable AI extraction provider interface
- Deterministic material evaluation, preference matching, scoring, size confidence, and care guide
- Local analysis history through a repository layer backed by `localStorage`
- Unit tests for core domain logic

## Mock Boundaries

- Demo analysis still uses local sample data for a reliable walkthrough.
- The AI extraction provider is currently unavailable by default, so no API key is required.
- Manual paste parsing is intentionally lightweight and designed as a replaceable adapter.
- Product images use public demo imagery.

## Next Steps

- Connect a schema-constrained AI extraction provider behind `ProductExtractionProvider`.
- Add site-specific parsers for major shopping malls.
- Move profile/history repositories to Supabase or Postgres.
- Add authentication and cross-device sync.
- Add product comparison using the normalized `ProductFacts` and `AnalysisResult` shapes.
