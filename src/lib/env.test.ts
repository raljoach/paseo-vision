import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EnvSource,
  LIMIT_DEFAULTS,
  checkEnv,
  getAppConfig,
  getClientEnv,
  getServerEnv,
} from "./env";

/** Minimal valid server env; tests override individual keys. */
const BASE_ENV = {
  POSTGRES_URL: "postgresql://user:pass@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  NODE_ENV: "test",
} as const satisfies EnvSource;

function env(overrides: EnvSource = {}): EnvSource {
  return { ...BASE_ENV, ...overrides };
}

/** Silences expected validation error logs and returns the spy. */
function silenceConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getServerEnv", () => {
  it("applies limit defaults when unset", () => {
    const parsed = getServerEnv(env());

    expect(parsed.CANDIDATE_LIMIT).toBe(10);
    expect(parsed.MAX_SEARCHES_PER_RUN).toBe(15);
    expect(parsed.SEARCH_CONCURRENCY).toBe(4);
    expect(parsed.MAX_CLARIFICATIONS).toBe(3);
    expect(parsed.DEFAULT_TIMEFRAME_DAYS).toBe(30);
    expect(parsed.ANON_RETENTION_DAYS).toBe(30);
    expect(parsed.OFFER_STALE_MINUTES).toBe(30);
    expect(parsed.FLIGHT_CACHE_TTL_MINUTES).toBe(10);
    expect(parsed.FLIGHT_PROVIDER).toBeUndefined();
    expect(parsed.OPENAI_MODEL).toBeUndefined();
  });

  it("defaults NODE_ENV to development", () => {
    const { NODE_ENV: _omit, ...rest } = BASE_ENV;
    expect(getServerEnv(rest).NODE_ENV).toBe("development");
  });

  it("coerces numeric strings to integers", () => {
    const parsed = getServerEnv(
      env({ CANDIDATE_LIMIT: "8", MAX_SEARCHES_PER_RUN: "12", SEARCH_CONCURRENCY: "2" })
    );

    expect(parsed.CANDIDATE_LIMIT).toBe(8);
    expect(parsed.MAX_SEARCHES_PER_RUN).toBe(12);
    expect(parsed.SEARCH_CONCURRENCY).toBe(2);
  });

  it.each(["abc", "0", "-1", "1.5"])("rejects invalid limit value %j", (value) => {
    const errorSpy = silenceConsoleError();

    expect(() => getServerEnv(env({ SEARCH_CONCURRENCY: value }))).toThrow(
      "Invalid server environment variables"
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it("treats empty strings as unset for optional keys and limits", () => {
    const parsed = getServerEnv(
      env({
        BLOB_READ_WRITE_TOKEN: "",
        OPENAI_API_KEY: "",
        FLIGHT_PROVIDER: "",
        CRON_SECRET: "  ",
        CANDIDATE_LIMIT: "",
      })
    );

    expect(parsed.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    expect(parsed.OPENAI_API_KEY).toBeUndefined();
    expect(parsed.FLIGHT_PROVIDER).toBeUndefined();
    expect(parsed.CRON_SECRET).toBeUndefined();
    expect(parsed.CANDIDATE_LIMIT).toBe(LIMIT_DEFAULTS.CANDIDATE_LIMIT);
  });

  it("rejects CANDIDATE_LIMIT greater than MAX_SEARCHES_PER_RUN", () => {
    const errorSpy = silenceConsoleError();

    expect(() =>
      getServerEnv(env({ CANDIDATE_LIMIT: "16", MAX_SEARCHES_PER_RUN: "15" }))
    ).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        CANDIDATE_LIMIT: [expect.stringContaining("MAX_SEARCHES_PER_RUN")],
      })
    );
  });

  it("allows CANDIDATE_LIMIT equal to MAX_SEARCHES_PER_RUN", () => {
    const parsed = getServerEnv(env({ CANDIDATE_LIMIT: "15" }));
    expect(parsed.CANDIDATE_LIMIT).toBe(15);
  });

  it("rejects FLIGHT_PROVIDER=fixtures in production", () => {
    const errorSpy = silenceConsoleError();

    expect(() =>
      getServerEnv(env({ NODE_ENV: "production", FLIGHT_PROVIDER: "fixtures" }))
    ).toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        FLIGHT_PROVIDER: [expect.stringContaining("not allowed when NODE_ENV=production")],
      })
    );
  });

  it.each(["development", "test"])("allows FLIGHT_PROVIDER=fixtures in %s", (nodeEnv) => {
    const parsed = getServerEnv(env({ NODE_ENV: nodeEnv, FLIGHT_PROVIDER: "fixtures" }));
    expect(parsed.FLIGHT_PROVIDER).toBe("fixtures");
  });

  it("allows FLIGHT_PROVIDER=duffel in production", () => {
    const parsed = getServerEnv(env({ NODE_ENV: "production", FLIGHT_PROVIDER: "duffel" }));
    expect(parsed.FLIGHT_PROVIDER).toBe("duffel");
  });

  it("rejects unknown FLIGHT_PROVIDER values", () => {
    silenceConsoleError();
    expect(() => getServerEnv(env({ FLIGHT_PROVIDER: "amadeus" }))).toThrow();
  });

  it.each(["POSTGRES_URL", "BETTER_AUTH_SECRET"] as const)(
    "rejects a missing %s",
    (key) => {
      silenceConsoleError();
      const { [key]: _omit, ...rest } = BASE_ENV;
      expect(() => getServerEnv(rest)).toThrow("Invalid server environment variables");
    }
  );

  it("rejects a short BETTER_AUTH_SECRET", () => {
    silenceConsoleError();
    expect(() => getServerEnv(env({ BETTER_AUTH_SECRET: "short" }))).toThrow();
  });
});

describe("getAppConfig", () => {
  const SECRETS = {
    OPENAI_API_KEY: "sk-test-openai-secret",
    DUFFEL_ACCESS_TOKEN: "duffel_test_secret",
    GOOGLE_PLACES_API_KEY: "places-secret",
  } as const;

  it("returns camelCase limits with defaults", () => {
    expect(getAppConfig(env()).limits).toEqual({
      candidateLimit: 10,
      maxSearchesPerRun: 15,
      searchConcurrency: 4,
      maxClarifications: 3,
      defaultTimeframeDays: 30,
      anonRetentionDays: 30,
      offerStaleMinutes: 30,
      flightCacheTtlMinutes: 10,
    });
  });

  it("does not require database or auth secrets", () => {
    expect(() => getAppConfig({ NODE_ENV: "test" })).not.toThrow();
  });

  it("reports configured flags without exposing secret values", () => {
    const config = getAppConfig(env({ ...SECRETS, FLIGHT_PROVIDER: "duffel" }));

    expect(config.flightProvider).toBe("duffel");
    expect(config.providers).toEqual({
      openai: { configured: true },
      duffel: { configured: true },
      googlePlaces: { configured: true },
    });

    const serialized = JSON.stringify(config);
    for (const secret of [...Object.values(SECRETS), BASE_ENV.BETTER_AUTH_SECRET]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("reports providers as unconfigured when keys are empty", () => {
    const config = getAppConfig(
      env({ OPENAI_API_KEY: "", DUFFEL_ACCESS_TOKEN: "", GOOGLE_PLACES_API_KEY: "" })
    );

    expect(config.providers.openai.configured).toBe(false);
    expect(config.providers.duffel.configured).toBe(false);
    expect(config.providers.googlePlaces.configured).toBe(false);
  });

  it("is deeply frozen", () => {
    const config = getAppConfig(env());

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.limits)).toBe(true);
    expect(Object.isFrozen(config.providers)).toBe(true);
    expect(Object.isFrozen(config.providers.openai)).toBe(true);
  });

  it("applies the same cross-field rules as getServerEnv", () => {
    silenceConsoleError();

    expect(() =>
      getAppConfig({ NODE_ENV: "production", FLIGHT_PROVIDER: "fixtures" })
    ).toThrow("Invalid application configuration");
    expect(() => getAppConfig({ CANDIDATE_LIMIT: "20" })).toThrow();
  });
});

describe("getClientEnv", () => {
  it("defaults NEXT_PUBLIC_APP_URL when unset or empty", () => {
    expect(getClientEnv({}).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(getClientEnv({ NEXT_PUBLIC_APP_URL: "" }).NEXT_PUBLIC_APP_URL).toBe(
      "http://localhost:3000"
    );
  });

  it("rejects an invalid URL", () => {
    silenceConsoleError();
    expect(() => getClientEnv({ NEXT_PUBLIC_APP_URL: "not a url" })).toThrow();
  });
});

describe("checkEnv", () => {
  it("throws when required variables are missing", () => {
    expect(() => checkEnv({})).toThrow("POSTGRES_URL is required");
    expect(() => checkEnv({ POSTGRES_URL: BASE_ENV.POSTGRES_URL })).toThrow(
      "BETTER_AUTH_SECRET is required"
    );
  });

  it("warns about unconfigured providers in development", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    checkEnv(env({ NODE_ENV: "development" }));

    const output = warnSpy.mock.calls.flat().join("\n");
    expect(output).toContain("OPENAI_API_KEY");
    expect(output).toContain("DUFFEL_ACCESS_TOKEN");
    expect(output).toContain("GOOGLE_PLACES_API_KEY");
  });

  it("does not log warnings outside development", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    checkEnv(env({ NODE_ENV: "test" }));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
