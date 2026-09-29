# Modules

Domain modules for Paseo (see `PLAN.md` §3). Each module exposes its public API
from `index.ts`; everything else is internal.

| Module            | Responsibility                                                                                                     | Pure |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ---- |
| `conversation`    | Conversations, messages, state machine, session/anon id, rate limits                                               |      |
| `agents`          | Orchestrator, seeker, roamer, prompts, composer, reply validator; `llm/` = LlmPort, `llm/openai/` = OpenAI adapter |      |
| `trip-planning`   | Constraint schema, merge, resolvers, readiness, assumptions, next-action policy                                    | yes  |
| `decision-engine` | Candidates, pre-rank, search planner, filter, rank, diversity, facts                                               | yes  |
| `destinations`    | Seeded catalog, airports dataset, climate lookup                                                                   | yes  |
| `travel-data`     | `ports/` (public), `adapters/` (private), normalization, cache, freshness                                          |      |
| `trips`           | Saved trips, trip places, save/claim/delete                                                                        |      |
| `analytics`       | EventSink port, DB sink, event types                                                                               |      |
| `auth`            | BetterAuth wrapper, anonymous-to-user claim                                                                        |      |
| `privacy`         | Retention job, export/delete                                                                                       |      |

## Enforced boundaries

Enforced by `no-restricted-imports` / `no-restricted-syntax` in
`eslint.config.mjs` and covered by `tests/architecture/module-boundaries.test.ts`.

- **Public API only.** From outside module `M`, import `@/modules/M` only.
  The single public subpath is `@/modules/travel-data/ports`. Cross-module
  imports must use the `@/modules/...` alias, never relative paths. (This also
  keeps other modules' DB tables private.)
- **Pure modules** (`trip-planning`, `decision-engine`, `destinations`): no DB,
  auth, env, framework, LLM, provider SDK or Node I/O imports; no stateful
  modules. No `Date.now()`, `new Date()`, `Math.random()`, `process.env` or
  global `fetch()` — clock, RNG and config are injected (PLAN §9).
- **decision-engine** uses `@/modules/travel-data/ports` only, never the
  travel-data root or adapters.
- **OpenAI SDK** (`openai`, `@ai-sdk/openai`) only in `agents/llm/openai/`.
- **Duffel SDK** (`@duffel/*`) only in `travel-data/adapters/duffel/`.
- **Route handlers** in `src/app` stay thin and call module public APIs.
