# Multi-Tenant Recommendation Platform — Architecture Plan

**Planned future name:** once this work begins, the project should be renamed **"Recommendation Agent"** (dropping the car-parts-specific name, since it will no longer be tied to one product vertical).

**Status:** Planning only — not started. Captures the reasoning from a 2026-09-20 discussion so the actual build can pick up cleanly without re-deriving the design from scratch.

**Goal:** evolve `car-parts-ai-recommendation` from a single-client (BMW parts) bot into a reusable platform that can serve many different clients, across different product verticals (car parts, mosaic tiles, furniture, etc.), from one shared codebase.

---

## The core problem

Almost everything in the current `chat.js` is hardcoded and car-parts-specific:
- `matchCompatibility()`, `engineCodesOverlap()`, `normalizeModel()` all assume "vehicle fitment" as the matching concept — makes no sense for tiles (no engine codes) or furniture (no VIN numbers).
- Haiku's extraction schema (`engineCode`, `powerHp`, `fuelType`, etc.) is automotive-specific.
- The system prompt is hardcoded, not configurable.
- The catalog source (ABCP feed) is car-parts-specific.

None of this can be reused as-is for a different vertical or a different client with different needs.

---

## The plan: everything client-specific becomes data, not code

### 1. A `clients` table (per-client config, loaded at request time)
One row per business using the platform. At minimum:
- `client_id` (primary key)
- `name`, `domain` (or embed-widget ID / API key — however the incoming request identifies which client it's for)
- `system_prompt` — the client's custom conversational instructions, **stored in the DB, not hardcoded**. Loaded fresh on each request (or cached briefly) based on which client the request belongs to.
- `catalog_connector` — which catalog-fetching strategy this client uses (see below)
- `matching_strategy` — which matching algorithm this client uses (see below)
- Any other per-client settings (branding, contact info, escalation phone/email, etc.)

**Request flow:** incoming chat request → identify client (by domain/API key/widget config) → load that client's row from `clients` → use its `system_prompt`, `catalog_connector`, and `matching_strategy` to build the response. Onboarding a new client becomes "add a row," not "write new code."

### 2. Pluggable matching strategies
The vehicle-compatibility logic that exists today (`matchCompatibility()` and friends) becomes **one strategy among several**, not the only one:
- `vehicle_compatibility` — today's brand/model/engine/year matching, for car parts
- `attribute_filter` (or similar) — simpler tag/attribute matching (color, size, material, style) for tiles, furniture, etc.
- Haiku's extraction schema itself needs to be configurable per strategy too — a tile client doesn't need `engineCode`, it needs something like `color`/`size`/`roomType`.

### 3. Pluggable catalog connectors
Car parts pulls from the ABCP feed via `abcp-catalog-proxy`. A furniture or tile client will likely have a completely different feed format, or even live in a different Supabase table/stack entirely. The catalog-fetching layer needs to be swappable per client, not hardcoded to one feed shape.

### 4. Multi-tenancy within one app (already decided — see Self-Host-Migration.md)
Per the earlier infrastructure decision: **each app still gets its own full Supabase stack** (Option B, since these apps use Auth/Storage/Realtime). The many-clients-per-app problem inside that one stack is handled via standard row-level multi-tenancy — a `client_id` column on every table plus Row Level Security (RLS) policies — not by spinning up separate infrastructure per client.

---

## What this means in practice, roughly

- Extract the reusable "platform core" (conversation orchestration, Haiku→matching→Sonnet pipeline shape, error handling, logging patterns already hardened this migration) from the car-parts-specific 80% of the current code.
- Car-parts becomes the **first strategy/connector pair**, not the only path — same as it works today, just reachable through the `clients` table lookup instead of being the only option.
- New verticals (tiles, furniture, etc.) get added later as new strategy/connector implementations, not new deployments.

---

## Not decided yet / to figure out when this work actually starts
- Exact `clients` table schema (this doc has the concept, not the final DDL)
- How a client's domain/API key gets provisioned and mapped to their `client_id`
- Whether matching strategies are separate JS modules selected by a string key, or something more structured
- Whether the current car-parts data model needs any schema changes to fit under a `client_id` scope, or if it can be wrapped as-is (likely mostly as-is, just needs the `client_id` column + RLS added)

---

## When picking this up

Read this file alongside `Self-Host-Migration.md` (infrastructure/deployment side) and the current `car-parts-ai-recommendation` README (existing car-parts-specific implementation details) before starting. This doc is the "why" and rough shape; the actual schema/code design should happen as its own planning pass once work begins.
