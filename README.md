# GitHub Productivity Trends

A public, data‑driven project exploring whether AI coding tools are associated with measurable changes in developer productivity on GitHub.

The dashboard is live locally at `http://localhost:3000` when running the app.

## Why this exists

AI assistants (Copilot, ChatGPT‑style tools, Claude, etc.) are now part of many developers’ workflows. The big open question is whether they *actually* increase productivity in the real world, and for whom.  

This project looks at public GitHub activity over time to:
- measure changes in developer throughput and flow around the AI era
- compare different tiers of developers and languages
- build a foundation for adopter vs. non‑adopter causal analysis

## What we measure

**Primary outcome**
- **Average contributions per user per day** — derived from GitHub contribution calendars, so it includes commits, PRs, issues, and review contributions. We treat this as a broad “throughput” proxy.

**Secondary outcomes**
- **Lines changed per commit** — additions + deletions / commit, from repo stats.
- **PR merge time** — average time from PR open → merge.
- **Issue resolution time** — average time from issue open → close.

Vertical lines in charts mark major AI releases as reference points. They are **not** a direct measure of adoption.

## How we collect data

All data comes from **public GitHub APIs** (REST + GraphQL) and is stored locally via Prisma.

**Users**
- Sampled across follower‑based tiers (“top”, “mid”, “casual”).
- **Baseline activity filter:** users must have at least `BASELINE_MIN_CONTRIBUTIONS` (default 50) contributions in 2020–2021 to be included. This keeps the cohort focused on active developers pre‑AI.
- Sampling is deterministic via `SAMPLING_SEED` so cohorts are reproducible.

**Repositories**
- Sampled from popular repos across major languages.
- Used mainly for code‑volume and flow signals.

## Interpreting results

This dashboard is an **observational** view of public activity. It can show strong correlations, but correlation is not causation.  

We’re building adopter‑detection and diff‑in‑diff/event‑study analysis next so we can estimate causal impact while checking pre‑trends and robustness.

## Limitations (read this first)

- GitHub public contributions are not the same as workplace productivity.
- Contribution calendars include non‑commit work (issues/reviews). We use them intentionally as a broad signal, but they’re imperfect.
- Sampling is stratified but still biased toward public OSS activity.
- AI adoption is not directly observable yet; milestones are just temporal anchors.

## Run locally

1. Install dependencies  
   `npm install`
2. Create `.env` from the example and add a GitHub token  
   `cp .env.example .env`  
   Set `GITHUB_TOKEN=...` (scopes: `public_repo`, `read:user`)
3. Apply migrations  
   `npx prisma migrate dev`
4. Start the app  
   `npm run dev`
5. Sync data  
   Click “Sync GitHub Data” in the UI or run:  
   `curl -X POST "http://localhost:3000/api/sync?type=all"`

### Cohort configuration

You can control cohort size and reproducibility with env vars (see `.env.example`):
- `SAMPLING_SEED` — deterministic cohort seed.
- `BASELINE_MIN_CONTRIBUTIONS` — pre‑AI activity gate (default 50).
- `USERS_PER_BAND` — users sampled per follower band (e.g., 200 → ~2k users).
- `GRAPHQL_THROTTLE_MS` — delay between GraphQL requests to avoid rate limits.
- `DATABASE_URL` — point to a different SQLite DB (e.g. `dev_v1.db`).

## Roadmap

- Detect AI adoption signals per user/repo.
- Build a user‑month panel and run causal models (event‑study / diff‑in‑diff).
- Expand cohorts and add quality guardrails.
- Public launch with downloadable *aggregated* data and full methods.

## Contributing

Issues and PRs welcome. Please avoid adding any secrets; `.env` and local DBs are ignored by default.
