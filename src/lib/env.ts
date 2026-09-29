import { z } from "zod";

/**
 * Typed environment and application configuration.
 *
 * Validation is lazy: nothing is parsed at import time, so `next build` does
 * not require runtime secrets. Every accessor accepts an explicit `source`
 * (defaulting to `process.env`) so parsing is deterministic in tests.
 */

/** Any env-like record, e.g. `process.env` or a plain object in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Supported flight provider adapters (PLAN §8). */
export const FLIGHT_PROVIDERS = ["duffel", "fixtures"] as const;
export type FlightProviderName = (typeof FLIGHT_PROVIDERS)[number];

/** Default values for the configurable limits (PLAN §2.1). */
export const LIMIT_DEFAULTS = {
  CANDIDATE_LIMIT: 10,
  MAX_SEARCHES_PER_RUN: 15,
  SEARCH_CONCURRENCY: 4,
  MAX_CLARIFICATIONS: 3,
  DEFAULT_TIMEFRAME_DAYS: 30,
  ANON_RETENTION_DAYS: 30,
  OFFER_STALE_MINUTES: 30,
  FLIGHT_CACHE_TTL_MINUTES: 10,
} as const;

/**
 * `.env` files commonly contain `KEY=` for unset values. Treat empty (or
 * whitespace-only) strings as "unset" so optional keys and defaults behave
 * as if the variable were absent.
 */
function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalString() {
  return z.preprocess(emptyToUndefined, z.string().optional());
}

/** A positive integer read from a string env var, falling back to `fallback`. */
function positiveInt(fallback: number) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce
      .number()
      .int("Must be an integer")
      .positive("Must be a positive integer")
      .default(fallback)
  );
}

const nodeEnvShape = {
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "production", "test"]).default("development")
  ),
};

/** Non-secret-bearing settings needed to build the app config. */
const appConfigShape = {
  ...nodeEnvShape,

  // Flight provider selection. "fixtures" is for local development only.
  FLIGHT_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(FLIGHT_PROVIDERS).optional()
  ),

  // Provider credentials. Only their presence is exposed via getAppConfig().
  OPENAI_API_KEY: optionalString(),
  DUFFEL_ACCESS_TOKEN: optionalString(),
  GOOGLE_PLACES_API_KEY: optionalString(),

  // Limits (PLAN §2.1)
  CANDIDATE_LIMIT: positiveInt(LIMIT_DEFAULTS.CANDIDATE_LIMIT),
  MAX_SEARCHES_PER_RUN: positiveInt(LIMIT_DEFAULTS.MAX_SEARCHES_PER_RUN),
  SEARCH_CONCURRENCY: positiveInt(LIMIT_DEFAULTS.SEARCH_CONCURRENCY),
  MAX_CLARIFICATIONS: positiveInt(LIMIT_DEFAULTS.MAX_CLARIFICATIONS),
  DEFAULT_TIMEFRAME_DAYS: positiveInt(LIMIT_DEFAULTS.DEFAULT_TIMEFRAME_DAYS),
  ANON_RETENTION_DAYS: positiveInt(LIMIT_DEFAULTS.ANON_RETENTION_DAYS),
  OFFER_STALE_MINUTES: positiveInt(LIMIT_DEFAULTS.OFFER_STALE_MINUTES),
  FLIGHT_CACHE_TTL_MINUTES: positiveInt(LIMIT_DEFAULTS.FLIGHT_CACHE_TTL_MINUTES),
};

/**
 * Cross-field rules shared by the app-config and full server schemas.
 * Typed structurally so it applies to both parsed shapes.
 */
function refineCrossFieldRules(
  env: {
    NODE_ENV: "development" | "production" | "test";
    FLIGHT_PROVIDER?: FlightProviderName | undefined;
    CANDIDATE_LIMIT: number;
    MAX_SEARCHES_PER_RUN: number;
  },
  ctx: z.RefinementCtx
): void {
  // Fixtures return deterministic fake fares; they must never reach users
  // (PLAN §8, §13.8).
  if (env.NODE_ENV === "production" && env.FLIGHT_PROVIDER === "fixtures") {
    ctx.addIssue({
      code: "custom",
      path: ["FLIGHT_PROVIDER"],
      message:
        'FLIGHT_PROVIDER="fixtures" is not allowed when NODE_ENV=production; use "duffel"',
    });
  }

  // Every candidate needs at least one search, so the candidate count can
  // never exceed the per-run search cap.
  if (env.CANDIDATE_LIMIT > env.MAX_SEARCHES_PER_RUN) {
    ctx.addIssue({
      code: "custom",
      path: ["CANDIDATE_LIMIT"],
      message: `CANDIDATE_LIMIT (${env.CANDIDATE_LIMIT}) must be <= MAX_SEARCHES_PER_RUN (${env.MAX_SEARCHES_PER_RUN})`,
    });
  }
}

const appConfigEnvSchema = z
  .object(appConfigShape)
  .superRefine(refineCrossFieldRules);

/**
 * Server-side environment variables schema.
 * These variables are only available on the server.
 */
const serverEnvSchema = z
  .object({
    ...appConfigShape,

    // Database
    POSTGRES_URL: z.url("Invalid database URL"),

    // Authentication
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

    // OAuth
    GOOGLE_CLIENT_ID: optionalString(),
    GOOGLE_CLIENT_SECRET: optionalString(),

    // LLM (LlmPort). No default model: chosen by the OpenAI adapter (chunk D).
    OPENAI_MODEL: optionalString(),

    // Storage
    BLOB_READ_WRITE_TOKEN: optionalString(),

    // Vercel Cron shared secret
    CRON_SECRET: optionalString(),
  })
  .superRefine(refineCrossFieldRules);

/**
 * Client-side environment variables schema.
 * These variables are exposed to the browser via NEXT_PUBLIC_ prefix.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("http://localhost:3000")
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/** Tunable limits (PLAN §2.1), in camelCase. */
export interface AppLimits {
  readonly candidateLimit: number;
  readonly maxSearchesPerRun: number;
  readonly searchConcurrency: number;
  readonly maxClarifications: number;
  readonly defaultTimeframeDays: number;
  readonly anonRetentionDays: number;
  readonly offerStaleMinutes: number;
  readonly flightCacheTtlMinutes: number;
}

export interface ProviderStatus {
  readonly configured: boolean;
}

/**
 * Non-secret application configuration. Secrets are deliberately excluded;
 * adapters that need credentials read them via getServerEnv().
 */
export interface AppConfig {
  readonly limits: AppLimits;
  readonly flightProvider: FlightProviderName | undefined;
  readonly providers: {
    readonly openai: ProviderStatus;
    readonly duffel: ProviderStatus;
    readonly googlePlaces: ProviderStatus;
  };
}

/**
 * Validates and returns server-side environment variables.
 * Throws an error if validation fails.
 */
export function getServerEnv(source: EnvSource = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);

  if (!parsed.success) {
    console.error(
      "Invalid server environment variables:",
      z.flattenError(parsed.error).fieldErrors
    );
    throw new Error("Invalid server environment variables");
  }

  return parsed.data;
}

/**
 * Returns the typed, frozen, non-secret application config.
 * Does not require database/auth secrets, so it is usable from any server
 * module (and in tests) without a full environment.
 * Throws an error if validation fails.
 */
export function getAppConfig(source: EnvSource = process.env): AppConfig {
  const parsed = appConfigEnvSchema.safeParse(source);

  if (!parsed.success) {
    console.error(
      "Invalid application configuration:",
      z.flattenError(parsed.error).fieldErrors
    );
    throw new Error("Invalid application configuration");
  }

  const env = parsed.data;

  return Object.freeze({
    limits: Object.freeze({
      candidateLimit: env.CANDIDATE_LIMIT,
      maxSearchesPerRun: env.MAX_SEARCHES_PER_RUN,
      searchConcurrency: env.SEARCH_CONCURRENCY,
      maxClarifications: env.MAX_CLARIFICATIONS,
      defaultTimeframeDays: env.DEFAULT_TIMEFRAME_DAYS,
      anonRetentionDays: env.ANON_RETENTION_DAYS,
      offerStaleMinutes: env.OFFER_STALE_MINUTES,
      flightCacheTtlMinutes: env.FLIGHT_CACHE_TTL_MINUTES,
    }),
    flightProvider: env.FLIGHT_PROVIDER,
    providers: Object.freeze({
      openai: Object.freeze({ configured: Boolean(env.OPENAI_API_KEY) }),
      duffel: Object.freeze({ configured: Boolean(env.DUFFEL_ACCESS_TOKEN) }),
      googlePlaces: Object.freeze({
        configured: Boolean(env.GOOGLE_PLACES_API_KEY),
      }),
    }),
  });
}

/**
 * Validates and returns client-side environment variables.
 * Throws an error if validation fails.
 *
 * The default source references `process.env.NEXT_PUBLIC_APP_URL` literally
 * so Next.js can inline it into client bundles.
 */
export function getClientEnv(
  source: EnvSource = { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL }
): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    console.error(
      "Invalid client environment variables:",
      z.flattenError(parsed.error).fieldErrors
    );
    throw new Error("Invalid client environment variables");
  }

  return parsed.data;
}

/**
 * Checks if required environment variables are set.
 * Logs warnings for missing optional variables (development only).
 */
export function checkEnv(source: EnvSource = process.env): void {
  const warnings: string[] = [];

  // Check required variables
  if (!source.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required");
  }

  if (!source.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }

  // Check optional variables and warn
  if (!source.GOOGLE_CLIENT_ID || !source.GOOGLE_CLIENT_SECRET) {
    warnings.push("Google OAuth is not configured. Social login will be disabled.");
  }

  if (!source.OPENAI_API_KEY) {
    warnings.push("OPENAI_API_KEY is not set. The travel agent cannot generate replies.");
  }

  if (source.FLIGHT_PROVIDER === "fixtures") {
    warnings.push("FLIGHT_PROVIDER=fixtures. Flight results are deterministic fake data.");
  } else if (!source.DUFFEL_ACCESS_TOKEN) {
    warnings.push("DUFFEL_ACCESS_TOKEN is not set. Live flight prices are unavailable.");
  }

  if (!source.GOOGLE_PLACES_API_KEY) {
    warnings.push("GOOGLE_PLACES_API_KEY is not set. Place details are unavailable.");
  }

  if (!source.BLOB_READ_WRITE_TOKEN) {
    warnings.push("BLOB_READ_WRITE_TOKEN is not set. Using local storage for file uploads.");
  }

  // Log warnings in development
  if (source.NODE_ENV === "development" && warnings.length > 0) {
    console.warn("\n⚠️  Environment warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }
}
