# Paseo MVI — Architecture & Implementation Plan

**Status:** Approved v3 (2026-09-28) — implementation may begin. Amendments made at approval are marked **[v3]**.
**Last updated:** 2026-09-28
**Guiding principle:** Paseo is a conversational decision-making system that determines which trips are actually feasible for a person's circumstances. It is not a travel chatbot and not a search form with an LLM on top.
**Core rule:** The LLM interprets and narrates. Deterministic code decides.
**Fundamental abstraction [v3]:** Conversation → Constraints → Decision → Evidence → Response. Seeker and Roamer are internal capabilities, not the primary architectural abstraction.

---

## 0. Decisions log (approved by product owner)

| # | Decision |
|---|---|
| D1 | Keep starter stack: Next.js App Router, TypeScript, Postgres + Drizzle, BetterAuth, Tailwind v4, shadcn/ui. No Express/Firestore/Supabase. |
| D2 | Modular monolith. No microservices. |
| D3 | One user-visible assistant ("Paseo"). Seeker/Roamer are internal capabilities. |
| D4 | OpenAI behind an `LlmPort`. LLM never supplies prices, availability, hours, or budget verdicts. |
| D5 | One flight provider implemented, behind `FlightProvider`. See §1. |
| D6 | Constraint status model: `provided \| assumed \| declined \| unknown`. Declined is never re-asked. |
| D7 | **[v3]** Minimum search readiness: origin + timeframe. A timeframe is never defaulted silently (see §6). |
| D8 | Anonymous use allowed; 30-day retention (configurable); claim-on-sign-in. |
| D9 | Vitest for unit/eval tests. No browser E2E unless the starter already ships it. |
| D10 | Provider fixtures for local dev; production path uses the real provider. Providers degrade gracefully when unconfigured. |
| D11 | Out of scope: voice, Twilio, Dialogflow, wearables, Scout, Planner agent, TikTok/Pinterest, referrals, Points, blockchain, social graph, maps, itinerary editor, booking. |
| D12 | **[v3]** Clarification policy: ask only when information is required to search or its absence would materially distort the result. Max 3 clarification questions before searching. Never re-ask a `declined` field. The `expectedImpact` algorithm is deferred. |
| D13 | **[v3]** Conservative search fan-out: ~10 candidates, hard cap 15 searches/run. All limits configurable (§2.1). |
| D14 | **[v3]** Destination catalog is simple and explainable. No opaque recommendation scores; fit reasons must be grounded in catalog/provider data. |
| D15 | **[v3]** `cost_tier` removed from the MVI schema (no defensible source). No destination cost estimates are shown. |
| D16 | **[v3]** Budget is total-trip. Airfare may be compared to it, but Paseo never says the whole trip fits while lodging/other costs are unpriced; airfare headroom and "lodging not yet priced" are always stated. |
| D17 | **[v3]** Technical: SSE status events + validated final response (no token streaming); Postgres rate limiting + daily kill switch; separate airports dataset; USD only; Vitest if no runner; 30-day anonymous retention; fixtures in dev, real provider in production. |
| D18 | **[v3]** Production gate: no live production traffic on Duffel until the §1.3 questions are answered and recorded in ADR 0001. |
| D19 | **[v3.1]** Travelers: default to 1 adult (`assumed`) when not stated, disclosed when relevant; replaced by any user-provided value; explicitly mentioned children are never treated as adults (see §6). |
| D20 | **[v3.1]** Reply validator is scoped to travel facts and time-sensitive/provider-derived claims, not every number in a reply (see §2.2). |

---

## 1. Flight provider evaluation

*Research date 2026-09-28. Verify terms with each vendor before committing; several details below come from third-party summaries.*

### 1.1 Candidates

| Criterion | **Duffel** | **Travelpayouts / Aviasales** | Others considered |
|---|---|---|---|
| Credentials quickly | Test token immediately; **live token requires account activation** (verification, payment details). Plan for days, not minutes. | Free token after affiliate signup, no brand approval for the Data API. | **Amadeus Self-Service:** shut down 2026-07-17. **Kiwi Tequila:** closed to new self-serve developers (affiliate-team gated). **Skyscanner:** partnership-gated; scraper actors are ToS/reliability risks — rejected. |
| Self-service | Yes; public docs, Node SDK (`@duffel/api`). | Yes for Data API. **Live Search API requires ~50k MAU** and per-search UX rules. | — |
| Data type | **Live offers** (search results with `expires_at`, ~30 min lifetime; not guaranteed at booking). | **Cached prices** from other users' Aviasales searches (kept ~2–7 days). May be missing or stale for a given route/date. | — |
| Coverage | 300+ airlines via NDC/GDS/LCC (some airlines need extra enablement). | Broad but only where users recently searched. | — |
| Multi-destination / "anywhere" | No anywhere-search: one offer request per origin/destination/date set. We fan out ourselves. | Has cheapest/calendar/popular-directions endpoints — good for discovery, but cached. | — |
| Date flexibility | One date set per request; we sample dates. | Calendar/month-matrix endpoints are a natural fit. | — |
| Rate limits | Not published as a hard number; search-to-book ratio policy applies. Confirm. | Documented per-token limits (see their "API rate limits" article). Confirm. | — |
| Cost during MVP | Test mode free. Live: $3/order + 1% managed content (only on bookings). **Excess-search fee reported at $0.005/search beyond a 1,500:1 search-to-book ratio.** With zero bookings, we likely pay it on every search (≈$0.075 per run at the 15-search cap). *Assumption — confirm with Duffel.* | Free. Revenue via affiliate links. | — |
| Commercial/affiliate requirements | Booking-oriented commercial model; search-only prototype is technically possible. Confirm terms for a non-booking product. | Affiliate program; results are meant to inform/drive traffic to Aviasales links. | — |
| Fit for non-booking prototype | Good technically; must confirm ToS. | Good for indicative pricing; cached nature conflicts with "real, grounded, current" hypothesis. | — |
| Terms on displaying results | Confirm. Prices must be presented as time-sensitive offers. | Cached prices must be labeled as indicative (they carry `found_at`). | — |

### 1.2 Recommendation

**Primary (implement): Duffel, live mode.** It is the only self-serve option that returns *current offers*, which is what the product hypothesis ("grounded, not LLM-invented") needs. Test mode returns only sandbox data (Duffel Airways) and must not be treated as real pricing.

**Not implemented, documented as next candidate: Travelpayouts Data API** — best suited to *candidate pre-screening* ("cheapest destinations from X this month") and calendar pricing, at the cost of staleness. The `FlightProvider` interface includes `priceKind` so a cached provider can be added without changing the engine.

### 1.3 Actions for the product owner (start now — lead time)

1. Create a Duffel account and begin live-mode activation (verification + payment method).
2. **[v3]** Verify directly with Duffel, and record the written answers in ADR 0001 before relying on live usage in production: (a) is a search-only, non-booking travel planner permitted; (b) current search fees when there are no bookings; (c) rate limits; (d) display/attribution requirements; (e) any minimum booking/conversion requirements.
3. Until live is active, development runs against deterministic fixtures (D10). Live access is a production gate (D18), not a development blocker. **The demo criterion "real, grounded options" is blocked until a live token exists.**

### 1.4 Pricing honesty rules (apply to any provider)

- Every offer carries `provider`, `fetchedAt`, `expiresAt?`, `priceKind`.
- UI/copy says "was priced at … as of <time>" — never "the price is" or "book now for".
- Offers older than `OFFER_STALE_MINUTES` (default 30) are shown as stale and re-priced before any "select" confirmation.

---

## 2. Final architecture

```
Channel (web chat now; voice/wearable later)
   │  POST /api/conversations/:id/messages
   ▼
Conversation module        session, persistence, state, rate limits
   ▼
Agents / Orchestrator      turn pipeline; Seeker + Roamer capabilities
   │   ├─ LlmPort  → extract(patch, intent)   [OpenAI adapter]
   │   ├─ Trip Planning (deterministic): merge → resolve → readiness → next action
   │   ├─ Decision Engine (deterministic): candidates → search → filter → rank → facts
   │   └─ LlmPort  → compose(reply from facts only) → Reply Validator
   ▼
Travel Data ports          FlightProvider · PlaceProvider · (Lodging, Content later)
   ▼
External APIs              Duffel · Google Places · OpenAI
```

**Turn pipeline (per user message):**
1. Persist message; emit `message_received`.
2. `extract` → `{ intent, patch, rawPhrases }` (structured output, schema-validated).
3. Deterministic resolvers convert phrases to values (dates, durations, airports). *The LLM never computes dates.*
4. `merge` patch into a new immutable `constraint_set` version; emit `constraint_extracted` / `constraint_declined`.
5. `decideNextAction(state, constraints, intent)` → one of `ask | propose_assumption | search | explain | refine | present_save | answer_side_question`.
6. Execute (search runs the Decision Engine).
7. `compose` builds the reply from a typed `facts` payload; **Reply Validator** checks it; on failure retry once, then fall back to a template reply.
8. Persist reply + `uiBlocks`; emit events; return.

**Reply validation [v3.1]:** see §2.2 for scope. **Streaming:** because replies are validated before display, tokens are not streamed. SSE streams *status events* (`extracting`, `searching`, `n_of_m_priced`) and then the validated final message.

**Cross-cutting:**
- **Config** via typed env module; providers report `isConfigured()`; missing provider → conversational degradation ("I can't check live fares right now"), never invented data.
- **Abuse/cost protection** (no new infra; Postgres counters): per-anonymous-id and per-IP daily caps on messages and searches, plus a global daily kill switch. All configurable.
- **Vercel limits:** set `maxDuration` on the message route; the search has a wall-clock budget and returns **partial results** rather than failing. *Verify plan's max duration.*

### 2.2 Reply validator scope [v3.1]

Goal: prevent hallucinated travel facts, not forbid ordinary numbers in conversation.

| Claim class | Examples | Validated against |
|---|---|---|
| **Provider-derived / time-sensitive facts** | Fares and totals, airline, stops, flight duration, offer dates and times, "as of" times, airport codes of offers, availability, opening hours, climate figures, headroom arithmetic | The structured `facts` for the relevant search run / place lookup (with `fetchedAt`) |
| **Constraint and assumption echoes** | "5 days", "$1,000 budget", "solo / 1 adult", "next 30 days", origin city, stated interests | Current `ConstraintSet` (including `assumed` entries and their disclosure) |
| **Ordinary conversational text** | Question wording, "one quick question", "3 options", ordinals, greetings | Not restricted |

Mechanics:
- Preferred path: the composer references provider-derived values by fact id (e.g., `{{fact:offer_2.total}}`) and code renders them, so they cannot drift.
- Residual free text is scanned for claim-class patterns (currency amounts, clock times, airline names, fare/stop/duration/hours/availability statements, temperatures, airport codes presented as offer details). Each match must equal a fact in scope; a constraint echo must equal the current constraint state.
- A budget mention requires the headroom statement and the "lodging not yet priced" disclosure (§4).
- Failure → retry once → template fallback. Numbers outside these classes never cause a failure.

### 2.1 Configurable limits [v3]

All values live in the typed env/config module; defaults are conservative and meant to be tuned from real usage.

| Key | Default | Meaning |
|---|---|---|
| `CANDIDATE_LIMIT` | 10 (target range 8–10) | Destinations sent to the flight provider per run |
| `MAX_SEARCHES_PER_RUN` | 15 | Hard cap on provider searches per run |
| `SEARCH_CONCURRENCY` | 4 | Parallel provider requests |
| `SEARCH_TIMEOUT_MS` / `SEARCH_WALL_CLOCK_MS` | set in chunk G | Per-request and per-run time budgets |
| `MAX_CLARIFICATIONS` | 3 | Clarification questions before searching |
| `DEFAULT_TIMEFRAME_DAYS` | 30 | Window offered when the user gives no timeframe |
| `ANON_RETENTION_DAYS` | 30 | Anonymous data retention |
| `OFFER_STALE_MINUTES` | 30 | Age after which an offer is shown as stale |
| `FLIGHT_CACHE_TTL_MINUTES` | 10 | Provider result cache |
| `DAILY_MESSAGE_CAP` / `DAILY_SEARCH_CAP` / `GLOBAL_KILL_SWITCH` | set in chunk E | Abuse and cost protection |

---

## 3. Module boundaries

```
src/modules/
  conversation/    conversations, messages, state machine, session/anon id, rate limits
  agents/          orchestrator, seeker, roamer, prompts, llm/ (LlmPort + openai adapter),
                   composer, reply-validator
  trip-planning/   constraint schema (zod), merge, resolvers (dates, duration, airport),
                   readiness, assumptions, next-action policy
  decision-engine/ candidate generation, pre-rank, search planner, filter, rank, diversity, facts
  destinations/    seeded catalog, airports dataset, climate lookup
  travel-data/     ports (FlightProvider, PlaceProvider), adapters (duffel, google-places,
                   fixtures), normalization, cache, freshness, provider result types
  trips/           saved trips, trip places, save/claim/delete
  analytics/       EventSink port, DB sink, event types
  auth/            BetterAuth wrapper, anonymous→user claim
  privacy/         retention job, export/delete
```

**Dependency rules (enforce with lint `no-restricted-imports` or dependency-cruiser):**
- `trip-planning`, `decision-engine`, `destinations` are **pure** (no I/O, no LLM, no `Date.now()` — clock injected). Highly testable.
- `decision-engine` depends on `travel-data` **ports only**, never adapters.
- `agents` depends on ports (`LlmPort`), never on the OpenAI SDK directly outside `llm/openai`.
- Route handlers are thin: validate (Zod) → call one module service → shape response.
- No module imports another module's DB tables; cross-module access goes through exported service functions.

---

## 4. Domain model

**Conversation** — one dialogue; owned by `userId` or `anonymousId`.
**ConstraintSet** — versioned snapshot of what we know about the trip.
**Constraint field** — `{ value, status, source, updatedAtVersion }`.
- `status`: `provided` (user said it) · `assumed` (Paseo proposed and user accepted, or a stated default) · `declined` (user said no/none/don't care) · `unknown`.
- `source`: `user | default | resolver`.

```
ConstraintSet {
  origin:        Field<{ airportCodes[]; label }>
  destination:   Field<{ kind: 'specific'; codes[] } | { kind: 'open' }>   // "surprise me"/"don't care" → open, provided
  timeframe:     Field<{ start; end; raw; kind: 'range'|'month'|'relative'|'fuzzy'; }>
  duration:      Field<{ minDays; maxDays; raw }>
  budget:        Field<{ amount; currency; scope: 'total_trip' }>
  travelers:     Field<{ adults; children? }>
  companions:    Field<string>
  interests:     Field<string[]>
  travelStyle:   Field<string[]>
  climate:       Field<'warm'|'mild'|'cool'|'any'>
  activities, lodging, flexibility: Field<...>
}
```

**SearchRun** — one execution of the Decision Engine against a ConstraintSet version; records provider status and caps used.
**TripOption** — ranked result: destination + flight offer(s) + `fitReasons` + `budgetCheck` + sources + `fetchedAt`.
**Trip** — a saved, user-owned selected option with constraints snapshot and (later) itinerary.
**Fact** — the only thing the composer may state as numeric/time-sensitive: `{ id, kind, value, unit, source, fetchedAt }`.

**Budget semantics.** `budget.scope` is always `total_trip`. The engine may state only:
- `airfare_exceeds_budget` (exclude), or
- `airfare_within_budget_lodging_unpriced` with `headroom = budget − airfare` (arithmetic, labeled).
It must **never** emit a "fits your total budget" verdict until a lodging/cost provider exists. **[v3]** Whenever a budget was given, the reply must state the airfare headroom and that lodging has not been priced yet (validator-enforced).

---

## 5. Database schema (Drizzle / Postgres)

Conventions per AGENTS.md: UUID PKs (random) for all non-BetterAuth tables; BetterAuth's `user.id` stays `text` and is referenced as such. **Run `drizzle generate` + `migrate`; never `push`.**

| Table | Columns (key ones) | Notes |
|---|---|---|
| `conversations` | `id uuid pk`, `user_id text null → user.id (cascade)`, `anonymous_id uuid null`, `state text`, `status text` (`active\|ended`), `pending_question jsonb null`, `tz text`, `last_activity_at`, `created_at` | CHECK: `user_id` or `anonymous_id` present. Index `(anonymous_id)`, `(user_id)`, `(last_activity_at)`. |
| `messages` | `id uuid`, `conversation_id → cascade`, `role` (`user\|assistant\|system`), `content text`, `ui_blocks jsonb`, `llm_meta jsonb` (model, tokens, no PII extras), `created_at` | |
| `constraint_sets` | `id uuid`, `conversation_id → cascade`, `version int`, `data jsonb`, `created_at` | Append-only; unique `(conversation_id, version)`. |
| `search_runs` | `id uuid`, `conversation_id`, `constraint_set_id`, `window jsonb`, `candidate_ids jsonb`, `searches_used int`, `provider_status jsonb`, `status`, `started_at`, `completed_at` | |
| `trip_options` | `id uuid`, `search_run_id → cascade`, `destination_id → destinations`, `rank int`, `offer jsonb` (normalized), `fit_reasons jsonb`, `budget_check jsonb`, `sources jsonb`, `fetched_at`, `expires_at null` | |
| `destinations` | `id uuid`, `slug unique`, `name`, `country_code`, `airport_codes text[]`, `lat`, `lon`, `climate jsonb` (12× `{avgHighC, rainDays}`), `climate_source text`, `style_tags text[]`, `interest_tags text[]`, `min_days`, `ideal_days` | Seeded, ~60–100 rows. **[v3]** No cost or score columns; see §9.1. |
| `airports` | `iata pk`, `name`, `city`, `country_code`, `lat`, `lon`, `metro text null` | Seeded from an open dataset (e.g., OurAirports); commercial service only. Used for origin resolution and distance. |
| `trips` | `id uuid`, `user_id text → user.id (cascade)`, `name`, `origin jsonb`, `destination jsonb`, `timeframe jsonb`, `duration_days`, `travelers jsonb`, `budget jsonb null`, `constraints jsonb`, `selected_option jsonb` (snapshot incl. `fetched_at`), `itinerary jsonb null`, `source_conversation_id null`, `created_at`, `updated_at` | Snapshot, not FK, to options so deleting conversations doesn't break trips. |
| `trip_places` | `id uuid`, `trip_id → cascade`, `google_place_id text`, `snapshot jsonb`, `snapshot_fetched_at` | Store `place_id` + short-TTL snapshot; refetch for hours etc. *Verify Google Places caching terms.* |
| `events` | `id uuid`, `name text`, `conversation_id null`, `user_id null`, `anonymous_id null`, `props jsonb`, `ts` | Index `(name, ts)`. PII-minimal props. |
| `feedback` | `id uuid`, `conversation_id`, `message_id null`, `rating smallint`, `comment text null`, `created_at` | |
| `usage_counters` | `key text`, `window_start date`, `count int` | PK `(key, window_start)`; rate limits/caps. |

**Privacy:** all user-linked tables cascade from `user`/`conversations`. `DELETE /api/me/data` removes conversations, messages, constraint sets, runs, options, trips, places, feedback, events for the identity. Retention job deletes anonymous conversations inactive > `ANON_RETENTION_DAYS` (default 30) — run via Vercel Cron. Raw provider payloads are not persisted (normalized only).

---

## 6. Conversation state machine

```
            ┌──────────────────────────────────────────────┐
            ▼                                              │
GREETING → GATHERING ──(assumption needed)──► CONFIRMING_ASSUMPTION
              │  ▲                                  │ accept/decline
              │  └──────────────────────────────────┘
              │ ready
              ▼
          SEARCHING ──(failure/partial)──► PRESENTING (with degraded notice)
              │ ok
              ▼
          PRESENTING ──(question about option)──► PRESENTING (Roamer)
              │ constraint change / "something cheaper/warmer"
              ▼
          REFINING ──► SEARCHING
              │ select
              ▼
          SAVE_PROMPT ──► ENDED (saved) | PRESENTING
```

| State | Owner | Exits |
|---|---|---|
| `greeting` | Seeker | first user message → `gathering` |
| `gathering` | Seeker | ready → `searching`; needs default → `confirming_assumption` |
| `confirming_assumption` | Seeker | yes → field `assumed`, re-evaluate; no → ask alternative or mark `declined` |
| `searching` | Engine | ok/partial → `presenting`; total failure → `presenting` with failure notice, offer retry |
| `presenting` | Roamer | option question → stay; constraint change → `refining`; select → `save_prompt` |
| `refining` | Seeker | merged patch → `searching` (or `gathering` if newly required info missing) |
| `save_prompt` | Roamer | signed in → save; anonymous → prompt sign-in, keep context |

**Clarification policy [v3] (deterministic; first match wins):**

Ask only when a field is (a) **required to search**, or (b) its absence would **materially distort** the result. Each question asks for one field, at most one question per turn, and every clarification (including the timeframe proposal) counts toward `MAX_CLARIFICATIONS` (3). Answering a side question does not count.

Priority order:
1. Intent is a side question → `answer_side_question`; keep `pending_question`; re-ask once afterwards.
2. **Origin** unknown → ask (required).
3. **Timeframe** unknown → ask (required; see timeframe rules below).
4. **Duration** unknown and not declined → ask (distorts flight-time sanity and `min_days` filtering). If declined, use each destination's `ideal_days` and disclose it.
5. **Preferences**: only if destination is `open` **and** climate, interests and style are all unknown and none declined (otherwise the candidate set is arbitrary) → ask one open question.
6. Anything else → do not ask. Budget, companions and lodging are never asked proactively.
7. **Travelers [v3.1]:**
   - Not stated, and nothing in the user's words implies more than one traveler → `travelers = { adults: 1 }`, `status = assumed`, `source = default`. No question is spent. Disclose when relevant, e.g., "I'll price this for 1 adult."
   - User later states travelers → new constraint version replaces the assumption (`provided`); if results exist, treat as a refinement and re-search.
   - User mentions **children** (or infants) → they are never counted as adults. A traveler count with child ages is required to price, so ask for the missing count/ages (this is a required-to-search question and counts toward the cap). Until answered, do not search.
   - Words implying multiple travelers without a count ("we", "my partner and I", "family trip") → ask the count (required-to-search) rather than defaulting to 1.
8. Otherwise → `search`.

Rules that always apply:
- A field with `status = declined` is never asked again.
- If `MAX_CLARIFICATIONS` is reached, stop asking optional questions and search with what we have, disclosing what was left broad (e.g., "I didn't ask about your interests, so these are broad — tell me what you like and I'll narrow them").
- Required fields (origin, timeframe) are asked first, so they normally fall within the cap. If either is still missing when the cap is reached, Paseo makes one plain statement of what it needs to proceed instead of asking further optional questions; it does not search.

**Timeframe rules [v3]:**
- A **provided** timeframe always takes precedence over any default. Fuzzy phrases ("next month", "around Christmas") are resolved by the deterministic date resolver; genuinely ambiguous ones trigger a clarification.
- **Missing** timeframe → ask explicitly, e.g., "Do you have dates in mind? If not, I can look at the next 30 days." Never default silently.
- User **accepts** the 30-day window → `timeframe.status = assumed`, `source = default`; the assumption is stated in the reply.
- User says timing **doesn't matter** ("anytime", "I don't care when") → the 30-day window is used, `assumed`, and **disclosed** in the reply.
- User **rejects** the 30-day window without giving another → ask once for a rough window; if none is given, Paseo states it needs some timeframe to search and does not search.
- The default window is `[today + 1 day, today + DEFAULT_TIMEFRAME_DAYS]` in the user's timezone.

**Special utterances:**
- "I don't have a budget" / "no idea" → that field `declined`.
- "I don't care where" / "surprise me" → destination `{kind:'open'}`, `provided`.
- "I don't care" to an interests question → `interests: declined`.
- Correction ("actually 7 days") → new version overrides; emit `refinement_requested` if results exist.
- Ambiguous dates/duration → resolver returns `needsClarification` with candidate interpretations; the ask presents them.
- "No" to the 30-day proposal → see timeframe rules above (not treated as "don't care").

---

## 7. MVI conversational flow

Example (target demo):

```
User:  I want to get away somewhere warm next month. About $1,000, five days, solo. I don't care where.
Paseo: [extract] timeframe="next month", climate=warm, budget=1000 (total_trip), duration=5, travelers=1,
                 destination=open. Origin unknown.
Paseo: Sounds good. Where would you be flying from?
User:  Orlando.
Paseo: [resolve MCO (+ metro alternatives?) → ready] "Searching for warm places you can reach from Orlando next
       month…" [status events]
Paseo: 4 options, each with: destination, dates priced, airfare as-of time, why it fits (climate, interests),
       budget note ("airfare $312 leaves $688; I haven't priced lodging, so I can't confirm the full trip stays
       under $1,000").
User:  Tell me more about option 2.        → Roamer: Places lookup + facts.
User:  Anything cheaper?                   → refine → search → present.
User:  Save option 2.                      → sign-in prompt (if anonymous) → trip saved.
```

Flow summary: Natural language → extract → resolve → clarify only if valuable → explicit assumptions → real search → deterministic filter/rank → 3–5 options → validated explanation → refine → save.

---

## 8. Provider interfaces (contracts; TypeScript signatures for spec purposes)

```ts
type ProviderResult<T> =
  | { status: 'ok'; data: T; fetchedAt: string }
  | { status: 'unconfigured' | 'timeout' | 'rate_limited' | 'no_results' | 'error'; message: string };

interface FlightProvider {
  readonly id: string;                 // 'duffel'
  isConfigured(): boolean;
  search(req: FlightSearchRequest, ctx: { signal: AbortSignal; timeoutMs: number }):
    Promise<ProviderResult<FlightOffer[]>>;
}

interface FlightSearchRequest {
  origin: string;            // IATA
  destination: string;       // IATA
  departDate: string;        // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  cabin?: 'economy';         // MVP: economy only
  maxConnections?: number;   // default 1
  currency: string;          // 'USD'
}

interface FlightOffer {
  providerOfferId: string;
  provider: string;
  priceKind: 'live_offer' | 'cached_indicative';
  total: { amount: string; currency: string };   // decimal string; no floats
  outbound: Itinerary; inbound?: Itinerary;
  airlines: string[]; stops: number; totalDurationMinutes: number;
  fetchedAt: string; expiresAt?: string;
  deepLink?: string;         // only if provider ToS allows
}

interface PlaceProvider {
  isConfigured(): boolean;
  searchNearby(q: { destinationLatLon; interests: string[]; limit: number }): Promise<ProviderResult<Place[]>>;
  getDetails(placeId: string, fields: PlaceField[]): Promise<ProviderResult<PlaceDetails>>; // hours only with fetchedAt
}

interface LlmPort {
  extract(input: { history; constraints; utterance; today; tz }): Promise<ExtractionResult>;  // JSON-schema output
  compose(input: { facts: Fact[]; action: NextAction; tone: 'paseo' }): Promise<string>;
}

interface EventSink { emit(e: PaseoEvent): Promise<void> }   // DB sink now; Mixpanel later
```

**Normalization rules:** amounts as decimal strings; times ISO-8601 with offset; Duffel-specific fields never leak past the adapter; every `ProviderResult` failure is a value, not an exception.
**Adapters:** `duffel` (production), `fixtures` (deterministic; selected by `FLIGHT_PROVIDER=fixtures`, refused when `NODE_ENV=production`).
**Cache:** short TTL cache (`FLIGHT_CACHE_TTL_MINUTES`, default 10) keyed by request; cached results retain original `fetchedAt`.

---

## 9. Decision Engine behavior

Input: `ConstraintSet`, `today`, catalog, `FlightProvider`. Output: `SearchRunResult { options[], facts[], degradation[] }`.

The engine is **explainable by construction**: no weighted or opaque scores. Selection and ordering use explicit, documented criteria, and every criterion that influenced a result is emitted as a `fitReason` grounded in catalog or provider data.

1. **Window resolution.** Timeframe → `[start,end]`. Duration → `[minDays,maxDays]`; if declined/unknown, each destination's `ideal_days` is used and flagged.
2. **Candidate filtering** (destination open; if specific, candidates = that destination only):
   - Hard filters: airport pair exists from origin; `min_days ≤ duration`; if climate provided and not `any`, the destination's catalog `avgHighC` for the window's months falls in the requested band; excludes origin's own metro.
   - Distance sanity: great-circle flight time vs duration (e.g., long flights discouraged for very short trips), using documented thresholds.
3. **Pre-selection (no network, explainable).** Each surviving candidate gets a *match profile*: the list of stated preferences it satisfies (climate band with the actual `avgHighC` values, interest tags matched, style tags matched, duration fit). Order by: (a) number of matched stated preferences (desc); (b) region round-robin so no more than 3 share a region; (c) shorter estimated flight time; (d) slug. Take the first `CANDIDATE_LIMIT` (default 10).
4. **Search plan.** Pass 1: one representative date pair per candidate (window midpoint) → ≤ `CANDIDATE_LIMIT` searches. Pass 2: for the top 3 after pass 1, up to 2 additional date pairs, limited by the remaining budget of `MAX_SEARCHES_PER_RUN` (default 15). Concurrency `SEARCH_CONCURRENCY`. Per-request timeouts and a wall-clock budget; on exhaustion proceed with what returned.
5. **Normalize** results; drop offers with missing price, expired offers, or `stops > maxConnections`.
6. **Budget filter.** If a budget is provided: exclude when `airfare > budget` (`airfare_exceeds_budget`); otherwise keep with `budgetCheck = { kind: 'airfare_only', airfare, headroom }`. Never assert total-trip fit.
7. **Final ordering (lexicographic, no weights):**
   1. passes all hard filters and the budget filter;
   2. more matched stated preferences first (skipped if the user stated none);
   3. lower airfare first (equivalently, more headroom);
   4. fewer stops;
   5. shorter total travel time;
   6. slug (stable tie-break).
   Then apply a diversity pass so that at most 2 options share a region.
8. **Select 3–5** options. If fewer than 3, say so and suggest which constraint to relax, computed from the run (e.g., "N more destinations were priced above your budget"), not guessed.
9. **Emit `facts` and `fitReasons`** as `{ code, params }`, e.g. `CLIMATE_AVG_HIGH { destination, month, avgHighC, source }`, `INTEREST_MATCH { tags }`, `AIRFARE_HEADROOM { airfare, headroom }`, `FEWER_STOPS`. No free-text reasons from the engine; the composer only verbalizes these.
10. **Degradation reporting:** `provider_unconfigured`, `partial_results {priced: n, of: m}`, `all_failed`. The reply must disclose these.

### 9.1 Catalog rules [v3]

- ~60–100 destinations. Fields: name, country, airports, lat/lon, 12 monthly climate entries (`avgHighC`, `rainDays`) with a recorded `climate_source`, `style_tags`, `interest_tags`, `min_days`, `ideal_days`.
- Tags come from a small controlled vocabulary (target ≤ 12 per axis), assigned editorially and reviewed by the product owner.
- Climate values come from a public climate-normals dataset, **not** from an LLM.
- No recommendation scores and no cost data. A destination is a candidate because of stated, checkable metadata, not because the system "thinks" it is a good pick.

**Determinism:** same inputs + same provider responses ⇒ identical output (clock and RNG injected).

---

## 10. API contracts

All routes: Zod-validated; JSON errors `{ error: { code, message } }`; identity from BetterAuth session or `paseo_anon` httpOnly cookie (random UUID, `SameSite=Lax`, `Secure`).

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/conversations` | anon or user | `{ tz }` | `201 { conversationId, greeting: Message }` — emits `conversation_started` |
| `GET /api/conversations/:id` | owner | — | `{ conversation, messages[], constraints, latestSearchRun? }` |
| `POST /api/conversations/:id/messages` | owner | `{ content: string (≤2000) }` | **SSE**: `status` events, then `message { message: Message, uiBlocks[], constraints, state }` or `error` |
| `POST /api/conversations/:id/options/:optionId/select` | owner | — | `{ option, nextPrompt }` (re-prices if stale) — emits `option_selected` |
| `POST /api/trips` | user | `{ conversationId, optionId, name? }` | `201 { trip }` — emits `trip_saved` |
| `GET /api/trips` · `GET /api/trips/:id` | user | — | trips |
| `DELETE /api/trips/:id` | user | — | `204` |
| `POST /api/me/claim` | user + anon cookie | — | `{ claimedConversations }` |
| `DELETE /api/me/data` | user (or anon cookie) | `{ confirm: true }` | `204` |
| `POST /api/feedback` | owner | `{ conversationId, messageId?, rating, comment? }` | `204` — emits `feedback_submitted` |
| `GET /api/cron/retention` | Vercel Cron secret | — | deletes expired anonymous data; also emits `conversation_abandoned` for inactive conversations |

**UI blocks** (`uiBlocks[]`): `option_cards` (destination, dates, airfare + "as of" time + provider, fit reasons, budget note, sources), `assumption_chips` (Yes/No quick replies), `sources_footer`. No filters, maps, calendars, or dashboards.

**Events** (all emitted from day one): `conversation_started, message_received, constraint_extracted, constraint_declined, assumption_proposed, assumption_accepted, search_started, search_completed, search_failed, options_presented, option_selected, refinement_requested, trip_saved, conversation_abandoned, feedback_submitted`. Props are minimal (field names, counts, durations, provider status) — no message text.
*Derived metric:* "resolved without unnecessary questions" = conversation reached `options_presented` with ≤ `MAX_CLARIFICATIONS` asks and zero re-asks of declined fields.

---

## 11. Implementation sequence

**[v3]** Each chunk is small and independently testable. After **every** chunk: lint, typecheck, and tests. `next build` at these checkpoints: after chunk A, at the end of Week 1, after chunk K, and at the end (N). Chunks that can run in parallel may be delegated to sub-agents (coordinator only, per AGENTS.md). Nothing from the out-of-scope list (D11) is built.

**Week 1 — Foundations & conversation core**
| Chunk | Scope | Depends on | Parallel? |
|---|---|---|---|
| A | Remove boilerplate pages; keep auth/theme/shell; module skeleton; typed env + `.env.example`; lint rules for module boundaries; Vitest setup | — | first |
| B | Drizzle schema + generate + migrate (never push); seed scaffolding | A | ‖ |
| C | `trip-planning`: constraint schema, merge, resolvers (dates, duration, airport), readiness, next-action policy + tests | A | ‖ |
| D | `LlmPort` + OpenAI adapter + extractor prompt/schema; eval harness + first 30 utterances | A | ‖ |
| E | Event layer (`EventSink`, DB sink) + rate-limit/usage counters | B | ‖ |
| F | Chat UI (DESIGN.md compliant): message list, composer, status line, option cards, assumption chips; responsive | A | ‖ |

**Week 2 — Data, engine, end-to-end**
| Chunk | Scope | Depends on |
|---|---|---|
| G | `travel-data`: Duffel adapter + normalization + fixtures adapter + cache + graceful degradation | A |
| H | Destination catalog (60–100) + airports seed; **product-owner review of catalog** | B |
| I | Decision engine (candidates → plan → filter → rank → facts) + tests | C, G, H |
| J | Composer + Reply Validator + template fallback | D, I |
| K | Orchestrator wiring, SSE route, state machine persistence | C, D, E, I, J |
| L | Google Places adapter + Roamer "tell me more" | G |
| M | Trips: save, list, delete, claim, `me/data` delete, retention cron | B, K |
| N | Full eval run, acceptance walkthrough, Vercel deploy config, docs | all |

**Weeks 3–6 (beta, not in this plan's scope):** refinement polish, Roamer depth, itinerary suggestions, feedback analysis, lodging provider evaluation.

---

## 12. Test strategy

Runner: Vitest (add if the starter lacks a runner — *cannot verify from here; confirm in repo*).

| Layer | What | Determinism |
|---|---|---|
| Unit — pure modules | merge, readiness, assumptions, next-action policy, date/duration/airport resolvers, candidate filtering, ranking/diversity, budget verdicts, fact generation | Fully deterministic; injected clock |
| Unit — providers | Duffel/Places response normalization from recorded fixtures; failure mapping (timeout, 429, empty) | Deterministic |
| Unit — reply validator | Per §2.2: rejects fabricated or contradicted fares/hours/airlines/durations/offer times; validates constraint echoes against state; accepts ordinary conversational numbers and formatting variants; fallback template path | Deterministic |
| Integration — orchestrator | Scripted conversations with a **stub `LlmPort`** returning canned patches + fixture flight provider; assert state transitions, events emitted, no re-ask of declined fields | Deterministic |
| Eval — extraction | ~40 utterances run against real OpenAI (`pnpm eval:extraction` equivalent; opt-in, needs key). Field-level assertions with tolerance; report pass rate per category. Not a CI gate initially (non-deterministic); tracked over time | Non-deterministic |
| Smoke | Route handlers: validation errors, ownership checks, anon cookie, claim, delete | Deterministic |

**Extraction eval set (44):** destination known (3) · destination unknown (3) · dates known (3) · no dates (2) · ambiguous dates (3) · ambiguous duration (3) · budget provided (3) · budget declined (2) · preferences provided (3) · preferences omitted (2) · multiple constraints in one message (4) · corrections (3) · changing mind after results (2) · unrelated side question (2) · "I don't care" (2) · "surprise me" (2) · travelers unstated (1) · children mentioned (2) · travelers corrected later (1).

---

## 13. MVP acceptance criteria

1. An anonymous tester, without signing in, completes: *"I want to get away somewhere warm next month. About $1,000, five days, solo. I don't care where."* → Paseo asks only for missing **origin** → returns 3–5 options priced from **live** provider data.
2. Every price shown includes provider and "as of" time; no copy implies a guaranteed price.
3. **[v3.1]** No reply states a provider-derived or time-sensitive travel fact (fare, airline, stops, duration, offer date/time, availability, opening hours, climate figure) that is absent from or contradicts the relevant structured `facts`; constraint and assumption echoes match the current constraint state; ordinary conversational numbers are not restricted (validator enforced per §2.2; verified by tests, including negative cases with fabricated fares/hours).
4. Budget language never claims total-trip fit; the airfare-only note appears whenever a budget was given.
5. A declined field is never asked again (asserted in tests).
6. **[v3]** A missing timeframe is never defaulted silently: Paseo asks whether to use the next 30 days; acceptance records `assumed`; "don't care about timing" uses the 30-day window as `assumed` and discloses it; a provided timeframe always wins. Verified by tests.
7. Search uses ≤ `MAX_SEARCHES_PER_RUN`; partial provider failure yields partial results with disclosure; total failure yields an honest message.
8. With no provider credentials, the app runs on fixtures in dev and refuses fixtures in production.
9. Refinement ("cheaper", "warmer", "7 days instead") re-searches and re-presents.
10. Signed-in user can save a trip; anonymous user can claim their conversation on sign-in; user can delete a trip and all their data.
11. All 15 events fire in the right places (asserted in integration tests).
12. Anonymous data older than `ANON_RETENTION_DAYS` is purged by the cron job.
13. Lint, typecheck, unit tests, and `next build` pass; UI follows DESIGN.md; usable at mobile, tablet, desktop widths.
14. Extraction eval pass rate is recorded (target to be set after the first run, not asserted a priori).
15. **[v3]** No more than 3 clarification questions precede the first search; no `declined` field is re-asked.
16. **[v3]** Every displayed fit reason maps to a catalog or provider datum (asserted in tests); no destination-level opaque score exists in code or schema.
17. **[v3]** Search volume: a run uses ≤ `MAX_SEARCHES_PER_RUN` (default 15) with ~10 candidates.

---

## 14. Risks & open items

| Item | Risk | Mitigation / owner |
|---|---|---|
| Duffel live activation lead time | Blocks "real data" demo | Start now (product owner) |
| Duffel search-only terms, fees, limits, attribution, minimum bookings | Cost/ToS surprise | **Production gate (D18):** answers recorded in ADR 0001 before live production use; keep `MAX_SEARCHES_PER_RUN` low |
| Duffel offer-request latency | Long waits on fan-out | Timeouts, concurrency, partial results, status streaming |
| Vercel function duration | Search exceeds limit | Wall-clock budget; verify plan limit; fall back to async run + polling if needed |
| Catalog climate accuracy | Wrong "warm" claims | Seed from a public climate-normals dataset (not LLM-generated); record `climate_source`; owner reviews catalog |
| Origin resolution ambiguity (city → airports) | Wrong airport | Airports dataset + metro grouping; ask when ambiguous |
| Google Places terms on caching/attribution | Compliance | Store `place_id` + short-TTL snapshot; verify terms during chunk L |
| Cost abuse on anonymous access | LLM/search spend | Per-identity and global daily caps; kill switch |
| Extraction quality | Bad constraints | Eval harness from Week 1; resolvers deterministic |

**Resolved at approval [v3]:** Duffel as sole provider (with production gate); SSE status + validated final response; Postgres rate limiting and kill switch; separate airports dataset; USD only; Vitest if needed; 30-day anonymous retention.

**Choices made while applying the adjustments (flagged for your review):**
1. Travelers default to 1 adult, recorded as `assumed` and disclosed, rather than being asked.
2. Ranking is lexicographic (preferences matched → airfare → stops → duration) rather than weighted.
3. `cost_tier` is removed from the schema entirely rather than kept unused.
4. Required fields are asked first so they fall within the 3-question cap; if a required field is still missing at the cap, Paseo states what it needs rather than searching.
5. `next build` checkpoints: after A, end of Week 1, after K, and at the end.