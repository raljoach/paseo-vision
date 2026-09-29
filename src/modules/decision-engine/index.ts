/**
 * Decision Engine module (public API).
 *
 * Candidate generation, pre-rank, search planner, filter, rank, diversity, facts.
 * Depends on travel-data ports only, never adapters. See PLAN.md §3, §9.
 *
 * Pure: no I/O, no LLM, no framework imports; clock/RNG/config are injected.
 */
export {};
