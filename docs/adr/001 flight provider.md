# ADR 0001 — Flight provider for the Paseo MVI

**Status:** Accepted (2026-09-28) — with a production gate (below)
**Date:** 2026-09-28

## Context
Paseo must ground trip options in real, current flight pricing. Amadeus Self-Service was decommissioned on 2026-07-17 and the product owner has no Enterprise access. Kiwi Tequila no longer offers open self-serve signup. Only one provider is to be implemented, behind `FlightProvider`.

## Decision
Implement **Duffel (live mode)** as the sole provider. Keep `FlightProvider` provider-agnostic (`priceKind: 'live_offer' | 'cached_indicative'`) so a second provider can be added without engine changes.

## Alternatives considered
- **Travelpayouts / Aviasales Data API:** free token, no approval, calendar and cheapest-destination endpoints, but prices are cached from other users' searches (stored days), so they may be missing or stale. Live Search API requires ~50k MAU. Best candidate as a *second* provider for pre-screening.
- **Amadeus Self-Service:** unavailable.
- **Kiwi Tequila:** gated behind affiliate team.
- **Skyscanner / scrapers:** partnership-gated or ToS/reliability risk.

## Consequences
- Live token needs Duffel account activation; development uses fixtures until then.
- Test mode is sandbox data and must never be shown as real pricing.
- Offers expire (~30 min) and are not guaranteed; UI must show provider and `fetchedAt`.
- Search-only usage terms and search fees (reported excess-search fee beyond a 1,500:1 search-to-book ratio) must be confirmed with Duffel.
- Duffel has no "anywhere" search; the Decision Engine fans out over ~10 candidates with a hard cap of `MAX_SEARCHES_PER_RUN` (default 15) requests, all configurable.

## Revisit when
Duffel terms disallow search-only use, costs exceed budget, or latency makes fan-out impractical.

## Production gate (required before live production use)
Verify directly with Duffel and record the written answers below:

| Question | Answer | Date | Source |
|---|---|---|---|
| Is a search-only / non-booking travel planner permitted? | _pending_ | | |
| Current search fees when there are no bookings | _pending_ | | |
| Rate limits | _pending_ | | |
| Display / attribution requirements | _pending_ | | |
| Minimum booking / conversion requirements | _pending_ | | |

Until these are answered, development and demos use deterministic fixtures. Fixtures are refused when `NODE_ENV=production`.