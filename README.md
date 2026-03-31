# Saginaw Bay Fishing Aggregator (MVP)

Local-first decision dashboard for Saginaw Bay anglers.

## What this ships

- Daily `go / caution / no-go` bay call
- Zone-based scoring and recommendations
- Launch-level context
- Explainable "why this call"
- Focused conditions dashboard
- Fishing report aggregation layer
- Favorites + basic condition-change browser alerts
- Server-side private feed support (no token exposure)
- Lazy fetch behavior: no API call until user loads snapshot
- Daily snapshot lock: once generated, same snapshot is reused until next day

## Architecture

- Frontend: static `index.html` + `app.js`
- Backend: Vercel serverless functions in `/api`
- Data sources:
  - Open-Meteo weather + marine conditions
  - NWS active alerts
  - Optional private fishing API via env vars
  - Built-in fallback report seed when private feed is unavailable

All external API secrets stay server-side only.

## API endpoints

- `GET /api/health`
- `GET /api/daily-summary?species=walleye|perch|mixed&day=YYYY-MM-DD`

`/api/daily-summary` returns:

- Bay call + confidence
- Conditions
- Zone scores (safety, fishability, recent signal, confidence, friction)
- Launch recommendations
- Report summary + source agreement
- Source health status

## Environment variables

Create `.env.local` (or set in Vercel project settings):

```bash
PRIVATE_FISH_API_URL=https://your-private-feed.example/api/reports
PRIVATE_FISH_API_TOKEN=your-server-only-token
PRIVATE_FISH_API_TIMEOUT_MS=9000
```

If `PRIVATE_FISH_API_URL` is not set, the app still runs using fallback fishing-intel seed data.

## Run locally

Recommended:

```bash
npx vercel dev
```

Then open `http://localhost:3000`.

## Deploy

1. Push this folder to a GitHub repo.
2. Import repo into Vercel.
3. Set env vars in Vercel (`PRIVATE_FISH_API_*`).
4. Deploy.

## Notes on trust and transparency

- Recommendations include explicit drivers.
- Confidence is shown as a score and label.
- Safety override can force a no-go even when bite reports are positive.
- Source health is included in API output to indicate thin/degraded data conditions.
- Snapshot generation is intentionally frozen per day to avoid intra-day drift.
