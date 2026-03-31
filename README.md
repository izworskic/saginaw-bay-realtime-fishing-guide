# Saginaw Bay Realtime Fishing Guide (MVP)

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
- Optional OpenAI "Captain Note" generated only when user requests it

## Architecture

- Frontend: static `index.html` + `app.js`
- Backend: Vercel serverless functions in `/api`
- Data sources:
  - Open-Meteo weather + marine conditions
  - NOAA/NWS active alerts + NWS forecast grid marine fields
  - NOAA CO-OPS water-level station data (default Essexville, station `9075035`)
  - NWS shoreline forecast narrative near Bay City
  - Optional private fishing API via env vars
  - Built-in fallback report seed when private feed is unavailable

All external API secrets stay server-side only.

## API endpoints

- `GET /api/health`
- `GET /api/daily-summary?species=walleye|perch|mixed&day=YYYY-MM-DD&includeAi=1`
- `GET /api/objective-update?htdr=0.71&safetyMissRate=0.018&calibrationError=0.09`

`/api/daily-summary` returns:

- Bay call + confidence
- Conditions
- Zone scores (safety, fishability, recent signal, confidence, friction)
- Launch recommendations
- Report summary + source agreement
- Source health status
- Objective metadata (weights, constraints, and decision thresholds)

## Environment variables

Create `.env.local` (or set in Vercel project settings):

```bash
PRIVATE_FISH_API_URL=https://your-private-feed.example/api/reports
PRIVATE_FISH_API_TOKEN=your-server-only-token
PRIVATE_FISH_API_TIMEOUT_MS=9000
OPENAI_API_KEY=your-server-only-openai-key
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=12000
MODEL_WEIGHT_OVERRIDE_JSON={"safety":0.45,"fishability":0.25,"recentSignal":0.15,"confidence":0.10,"friction":0.05}
NOAA_WATER_LEVEL_STATION=9075035
```

If `PRIVATE_FISH_API_URL` is not set, the app still runs using fallback fishing-intel seed data.
If `OPENAI_API_KEY` is not set, the app still works and skips Captain Note generation.
If `MODEL_WEIGHT_OVERRIDE_JSON` is not set, default objective weights are used.

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
- AI Captain Note follows the same daily lock once generated.
- Objective function in production:
  - `U_t(z)=G_t(z)*(0.45*S_t(z)+0.25*F_t(z)+0.15*R_t(z)+0.10*C_t(z)-0.05*X_t(z))`
  - `G_t(z)=0` on hard safety override (advisory/wind/waves), else `1`
  - `GO` if max utility >= 70 and avg safety >= 60
  - `CAUTION` if utility in [50, 70)
  - `NO_GO` otherwise
