# Delivery Agent / Kapioo Admin — Route Optimizer Integration

Internal reference for machine-to-machine use of the Route Optimizer after Milestones 1–9.

**Important:** Route Optimizer is a **routing engine only** (geocode, optimize, persist runs, driver links). It does **not** implement delivery planning logic, order assignment, or Kapioo Admin business rules. Kapioo Admin / the Delivery Agent owns planning decisions and calls these APIs with finalized payloads.

## Environment

| Variable | Required for integration | Notes |
|----------|--------------------------|--------|
| `ROUTE_OPTIMIZER_INBOUND_TOKEN` | Yes (for integration APIs) | Server-only. Never expose to the browser or `NEXT_PUBLIC_*`. |

When unset or empty, all integration endpoints return **503** with code `INTEGRATION_NOT_CONFIGURED`.

Other env vars (`MONGODB_URI`, Google Maps, etc.) are required for the app to run but are unchanged by integration.

## Authentication

Every integration request must include:

```http
Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
Content-Type: application/json
```

| Condition | HTTP | Code / message |
|-----------|------|----------------|
| Token not configured on server | 503 | `INTEGRATION_NOT_CONFIGURED` |
| Missing or malformed `Authorization` | 401 | `UNAUTHORIZED` |
| Wrong token | 401 | `UNAUTHORIZED` |

Admin session cookies and driver link tokens are **separate** and are not used on these routes.

Rate limits (per client IP, in-memory): create-and-optimize 20/min, optimize-preview 30/min, batch 10/min, geocode-addresses 20/min.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/integrations/runs/optimize-preview` | Validate, geocode, optimize **in memory** — no DB write |
| `POST` | `/api/integrations/runs/create-and-optimize` | Create one run, geocode, optimize, persist |
| `POST` | `/api/integrations/runs/batch-create-and-optimize` | Same as single, up to **10** runs per batch |
| `POST` | `/api/integrations/geocode-addresses` | Batch geocode addresses only — **no run created**, no DB write |

Base URL is your deployed Route Optimizer origin (e.g. `https://delivery.kapioo.com`).

---

### 1. Optimize preview (no persistence)

**Use when:** Kapioo Admin wants ETAs/distances before committing runs.

**Response (success):** `preview: true`, `persisted: false`, `run_id: null`, `status: "preview"`. No `details_link` or `driver_link`. Does not appear on the dashboard and cannot start driver/SMS/Kapioo flows.

**Example request:**

```json
{
  "planning_session_id": "plan-2026-05-29-dt-ut",
  "created_by_integration": "kapioo-admin",
  "external_id": "preview-dt",
  "run": {
    "run_date": "2026-05-29",
    "driver_name": "DT Driver",
    "start_location": "123 Kitchen St, Toronto",
    "start_time": "10:00",
    "travel_mode": "driving",
    "end_location": "456 Depot Ave, Toronto"
  },
  "customers": [
    {
      "name": "Customer A",
      "phone": "4165550001",
      "address": "250 Yonge St, Toronto"
    },
    {
      "name": "Today's Meet up point",
      "phone": "",
      "address": "100 King St W, Toronto",
      "is_synthetic": true,
      "stop_type": "handoff"
    }
  ]
}
```

**Example success (excerpt):**

```json
{
  "preview": true,
  "persisted": false,
  "run_id": null,
  "status": "preview",
  "planning_session_id": "plan-2026-05-29-dt-ut",
  "total_duration_minutes": 95,
  "total_distance_km": 42.1,
  "optimized_route": { "stops": [] },
  "validation_errors": [],
  "warnings": []
}
```

---

### 2. Create and optimize (single persisted run)

**Metadata (optional but recommended):**

- `planning_session_id` — groups related runs (e.g. DT / UT / Self same day)
- `external_id` — Kapioo Admin reference for this run
- `idempotency_key` — duplicate-safe retries (see Idempotency)
- `created_by_integration` — source label (e.g. `kapioo-admin`)

**Success:** HTTP **201**, `run_id` set, `details_link` / `driver_link` when optimized.

**Replay:** HTTP **200**, same `run_id`, warning that existing run was returned.

**Conflict:** HTTP **409**, `code: "IDEMPOTENCY_CONFLICT"`, `run_id` of existing document.

**Validation / geocode / optimize failure:** HTTP **422**, structured body with `code`, `validation_errors`, `warnings`, and often `run_created_as_draft: true` with `run_id` if a draft was saved.

---

### 3. Batch create and optimize

**Envelope:**

```json
{
  "planning_session_id": "plan-2026-05-29-dt-ut",
  "created_by_integration": "kapioo-admin",
  "runs": [
    {
      "idempotency_key": "dt-2026-05-29",
      "external_id": "dt-2026-05-29",
      "run": { "run_date": "2026-05-29", "driver_name": "DT", "start_location": "Kitchen", "start_time": "10:00" },
      "customers": [{ "name": "A", "phone": "4165550001", "address": "250 Yonge St, Toronto" }]
    },
    {
      "idempotency_key": "ut-2026-05-29",
      "external_id": "ut-2026-05-29",
      "run": { "run_date": "2026-05-29", "driver_name": "UT", "start_location": "Meetup", "start_time": "10:45" },
      "customers": [
        { "name": "Today's Meet up point", "address": "100 King St W, Toronto", "is_synthetic": true, "stop_type": "handoff" },
        { "name": "B", "phone": "4165550002", "address": "200 Bay St, Toronto" }
      ]
    }
  ]
}
```

**Rules:**

- `planning_session_id` is **required** on the batch.
- Each item must include **`idempotency_key` or `external_id`** (or both).
- Processing is **sequential**; partial success is allowed (no rollback of successful items).
- Overall `status`: `success` | `partial` | `failed`.
- HTTP **201** only if every item is newly created (`success`); otherwise **200** (includes replays and partial failure).

**Example batch response (excerpt):**

```json
{
  "planning_session_id": "plan-2026-05-29-dt-ut",
  "status": "partial",
  "total_requested": 2,
  "total_succeeded": 1,
  "total_failed": 1,
  "runs": [
    { "index": 0, "status": "success", "run_id": "...", "driver_name": "DT" },
    { "index": 1, "status": "failed", "code": "GEOCODE_FAILED", "error": "..." }
  ],
  "errors": []
}
```

---

### 4. Geocode addresses (no persistence)

**Use when:** Kapioo Admin / Delivery Agent needs `lat`/`lng` per order **before** route planning (split, meet-up, assignment) without creating a delivery run.

- Does **not** create or update `DeliveryRun` records
- Does **not** send SMS or driver messages
- `idempotency_key` is accepted for correlation only (no replay store)
- Up to **50** addresses per request; geocoded **sequentially** (one Google call each)
- **No geocode result cache** across requests

**Example request:**

```json
{
  "created_by_integration": "kapioo-admin",
  "idempotency_key": "kapioo-geocode:2026-06-09:abc123",
  "addresses": [
    {
      "client_ref": "DD-90000001",
      "address": "Unit 1205, 25 Greenview Ave, North York M2M 1R4, Canada",
      "area": "North York",
      "country": "Canada"
    }
  ]
}
```

**Response (success — HTTP 200):**

```json
{
  "status": "completed",
  "total_requested": 1,
  "total_succeeded": 1,
  "total_failed": 0,
  "results": [
    {
      "client_ref": "DD-90000001",
      "input_address": "Unit 1205, 25 Greenview Ave, North York M2M 1R4, Canada",
      "formatted_address": "25 Greenview Ave, North York, ON ...",
      "lat": 43.8123,
      "lng": -79.4012,
      "geocode_status": "OK",
      "confidence": "high",
      "location_type": "ROOFTOP",
      "provider": "google",
      "status": "success"
    }
  ],
  "errors": []
}
```

Per-item failures use `status: "failed"` with `geocode_status` (e.g. `ZERO_RESULTS`) and `error`. Top-level `status` remains `"completed"` when the batch finishes (including partial failure).

**Validation (HTTP 400):**

```json
{
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [{ "field": "addresses[0].client_ref", "message": "client_ref is required." }]
}
```

**Rate limits:**

| Source | HTTP | Body / headers |
|--------|------|----------------|
| App (per IP) | 429 | `code: "RATE_LIMITED"`, `retry_after_seconds: 60`, `Retry-After: 60` |
| Google Geocoding API (`OVER_QUERY_LIMIT`) | 429 | Same; batch aborts on first provider rate limit (retry whole batch) |

**Note:** `optimize-preview` does **not** return per-customer coordinates on success — use this endpoint when Kapioo needs coords upstream of optimization.

---

## Synthetic / handoff stops

A stop is treated as handoff when `is_synthetic === true` **or** `stop_type === "handoff"`.

| Behavior | Handoff | Normal customer |
|----------|---------|-----------------|
| In optimized route | Yes | Yes |
| Driver UI | Visible, completable | Yes |
| Phone required (integration) | No (warning only if missing on normal stops) | Address required |
| SMS (ETA, delivered, broadcast) | Skipped | Sent when phone valid |
| Kapioo POD / delivery-started sync | Skipped (`synthetic-stop`) | When `order_ids` present |
| Service time cap (integration validation) | Max 5 min | Max 5 min |
| Effective timing (current) | 5 min per stop | 5 min per stop |

Handoff stops should use a clear name (e.g. "Today's Meet up point") and address or valid `lat`/`lng`.

---

## Route constraints (integration)

Supported on customers in the payload (same semantics as admin UI):

- `fixed_stop_position` (1-based, unique)
- `is_first_stop`
- `is_end_point`
- Run-level `end_location` when no customer end point

Invalid combinations return **422** with `validation_errors[]` (`field`, `message`, optional `customer_index`).

---

## Idempotency

Lookup order for create-and-optimize:

1. If `idempotency_key` is set → find by `idempotency_key`
2. Else if `external_id` is set → find by `external_id`

| Outcome | HTTP | Notes |
|---------|------|--------|
| No existing run | 201 | New run created |
| Existing run, same `run_date` and compatible `external_id` | 200 | Replay; no duplicate |
| Existing run, conflicting payload | 409 | `IDEMPOTENCY_CONFLICT` + `run_id` |

**Race condition:** MongoDB indexes on `idempotency_key` / `external_id` are **sparse and non-unique**. Two simultaneous requests with the same key could rarely create two runs. Safe for admin-paced retries; consider **unique sparse indexes** before unattended cron automation.

---

## Error response shape (single-run)

Common fields:

```json
{
  "error": "Human-readable summary",
  "code": "VALIDATION_ERROR | GEOCODE_FAILED | OPTIMIZATION_FAILED | ...",
  "run_id": "mongoId or null",
  "run_created_as_draft": false,
  "validation_errors": [{ "field": "customers[0].address", "message": "..." }],
  "geocode_failures": [{ "index": 0, "name": "...", "address": "...", "error": "..." }],
  "warnings": ["..."],
  "planning_session_id": "...",
  "external_id": "...",
  "idempotency_key": "..."
}
```

Preview errors also include `preview: true` and `persisted: false`.

---

## Admin UI (Milestones 8–9)

Integration-created runs show optional metadata on the dashboard and Run Details:

- **Integration** badge when `created_by_integration` is set
- **Planning session** shortened ID (full value in tooltip / copy on details)
- **External ID** and **idempotency key** on Run Details / Edit Run only

Manual runs without these fields are unchanged.

---

## Pre-production checklist

- [ ] `ROUTE_OPTIMIZER_INBOUND_TOKEN` set in production (strong random value)
- [ ] Token stored only in Kapioo Admin / secrets manager, not in frontend
- [ ] Kapioo Admin handles batch partial failures and 409 conflicts
- [ ] DT / UT / Self share one `planning_session_id` per planning batch
- [ ] Handoff meet-up stops sent with `is_synthetic` or `stop_type: "handoff"`
- [ ] Decide on unique idempotency indexes before automated cron
