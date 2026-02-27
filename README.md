# Kapioo Route Optimizer

Next.js App Router + TypeScript app for delivery route optimization.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `MONGODB_URI` – MongoDB connection string
   - `GOOGLE_MAPS_API_KEY` – Geocoding + Directions
   - `GOOGLE_CLOUD_PROJECT_ID` – For Fleet Routing (Phase 2)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` – Stringified service account JSON (Phase 2)

2. Install and run:
   ```bash
   npm install
   npm run dev
   ```

3. Open http://localhost:3000 and go to Dashboard.

## Phase 1

- Dashboard, create run, edit run with CRUD
- Paste customer data (tab-delimited Name, Address, Phone)
- Geocode customers (requires `GOOGLE_MAPS_API_KEY`)
- Nearby address override for failed geocodes
- Save blocked if any customer has failed geocode without override
