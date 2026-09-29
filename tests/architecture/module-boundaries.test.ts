import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Architecture tests for the module-boundary lint rules (PLAN.md §3, §9).
 *
 * Lints virtual files with the real eslint.config.mjs and asserts that only
 * the boundary rules fire. Messages are filtered by ruleId so unrelated rules
 * (unused vars, import/order, ...) cannot make these tests flaky.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const BOUNDARY_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);
// ESLint + typescript-eslint initialisation can take several seconds.
const ESLINT_TIMEOUT_MS = 60_000;

let eslint: ESLint;

async function boundaryViolations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error(`ESLint returned no result for ${filePath}`);
  return result.messages
    .filter((message) => message.ruleId !== null && BOUNDARY_RULES.has(message.ruleId))
    .map((message) => `${message.ruleId}: ${message.message}`);
}

async function expectViolation(filePath: string, code: string, ruleId: string) {
  const violations = await boundaryViolations(filePath, code);
  expect(violations.some((v) => v.startsWith(`${ruleId}:`))).toBe(true);
}

async function expectClean(filePath: string, code: string) {
  expect(await boundaryViolations(filePath, code)).toEqual([]);
}

const IMPORTS = "no-restricted-imports";
const SYNTAX = "no-restricted-syntax";

/** Snippet that imports and uses a binding, so the code is otherwise valid. */
const importStmt = (specifier: string) =>
  `import * as dep from "${specifier}";\nexport const used = dep;\n`;

describe("module boundaries (PLAN §3)", { timeout: ESLINT_TIMEOUT_MS }, () => {
  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT });
  });

  describe("public API only", () => {
    it("rejects deep imports from src/app into a module", async () => {
      await expectViolation(
        "src/app/api/trips/route.ts",
        importStmt("@/modules/trips/db"),
        IMPORTS
      );
    });

    it("allows importing a module's index from src/app", async () => {
      await expectClean("src/app/api/trips/route.ts", importStmt("@/modules/trips"));
    });

    it("rejects deep imports between modules", async () => {
      await expectViolation(
        "src/modules/conversation/service.ts",
        importStmt("@/modules/trips/db"),
        IMPORTS
      );
    });

    it("allows deep imports within the same module", async () => {
      await expectClean("src/modules/trips/service.ts", importStmt("@/modules/trips/db"));
    });

    it("rejects relative imports that reach into another module", async () => {
      await expectViolation(
        "src/modules/conversation/service.ts",
        importStmt("../travel-data/adapters"),
        IMPORTS
      );
    });

    it("rejects relative imports into src/modules from outside", async () => {
      await expectViolation("src/lib/example.ts", importStmt("../modules/trips"), IMPORTS);
    });

    it("allows relative imports within a module", async () => {
      await expectClean("src/modules/conversation/state/machine.ts", importStmt("../service"));
    });

    it("allows the public travel-data ports subpath", async () => {
      await expectClean(
        "src/modules/agents/orchestrator.ts",
        importStmt("@/modules/travel-data/ports")
      );
    });

    it("keeps travel-data adapters private", async () => {
      await expectViolation(
        "src/app/api/example/route.ts",
        importStmt("@/modules/travel-data/adapters"),
        IMPORTS
      );
    });
  });

  describe("decision-engine depends on travel-data ports only", () => {
    const file = "src/modules/decision-engine/example.ts";

    it("rejects travel-data adapters", async () => {
      await expectViolation(file, importStmt("@/modules/travel-data/adapters"), IMPORTS);
      await expectViolation(file, importStmt("@/modules/travel-data/adapters/duffel"), IMPORTS);
    });

    it("rejects the travel-data root", async () => {
      await expectViolation(file, importStmt("@/modules/travel-data"), IMPORTS);
    });

    it("allows travel-data ports and other pure modules", async () => {
      await expectClean(file, importStmt("@/modules/travel-data/ports"));
      await expectClean(file, importStmt("@/modules/destinations"));
    });

    it("rejects travel-data ports from other pure modules", async () => {
      await expectViolation(
        "src/modules/trip-planning/example.ts",
        importStmt("@/modules/travel-data/ports"),
        IMPORTS
      );
    });
  });

  describe("pure modules have no I/O, framework, LLM or DB imports", () => {
    const file = "src/modules/trip-planning/example.ts";

    it.each([
      "@/lib/db",
      "@/lib/env",
      "drizzle-orm",
      "drizzle-orm/pg-core",
      "next/server",
      "react",
      "openai",
      "node:fs",
      "@/modules/conversation",
    ])("rejects %s", async (specifier) => {
      await expectViolation(file, importStmt(specifier), IMPORTS);
    });

    it("rejects relative imports into src/lib", async () => {
      await expectViolation(
        "src/modules/destinations/catalog/example.ts",
        importStmt("../../../lib/db"),
        IMPORTS
      );
    });

    it("allows zod", async () => {
      await expectClean(file, importStmt("zod"));
    });

    it("applies to test files inside pure modules too", async () => {
      await expectViolation(
        "src/modules/decision-engine/rank.test.ts",
        importStmt("@/lib/db"),
        IMPORTS
      );
    });
  });

  describe("determinism in pure modules (PLAN §9)", () => {
    const file = "src/modules/decision-engine/example.ts";

    it.each([
      "export const now = Date.now();",
      "export const now = new Date();",
      "export const r = Math.random();",
      "export const key = process.env.X;",
      'export const res = fetch("https://example.com");',
    ])("rejects `%s`", async (code) => {
      await expectViolation(file, code, SYNTAX);
    });

    it("allows constructing a Date from an explicit value", async () => {
      await expectClean(file, 'export const d = new Date("2026-01-01");');
    });

    it("does not apply to stateful modules", async () => {
      await expectClean("src/modules/conversation/example.ts", "export const now = Date.now();");
    });
  });

  describe("OpenAI SDK only in agents/llm/openai", () => {
    it("rejects openai in the agents orchestrator", async () => {
      await expectViolation("src/modules/agents/orchestrator.ts", importStmt("openai"), IMPORTS);
      await expectViolation(
        "src/modules/agents/orchestrator.ts",
        importStmt("@ai-sdk/openai"),
        IMPORTS
      );
    });

    it("rejects openai outside src/modules", async () => {
      await expectViolation("src/app/api/example/route.ts", importStmt("openai"), IMPORTS);
    });

    it("allows openai in the OpenAI adapter", async () => {
      await expectClean("src/modules/agents/llm/openai/client.ts", importStmt("openai"));
      await expectClean("src/modules/agents/llm/openai/client.ts", importStmt("@ai-sdk/openai"));
    });
  });

  describe("Duffel SDK only in travel-data/adapters/duffel", () => {
    it("rejects @duffel/api elsewhere", async () => {
      await expectViolation(
        "src/modules/travel-data/adapters/fixtures/index.ts",
        importStmt("@duffel/api"),
        IMPORTS
      );
      await expectViolation("src/modules/travel-data/cache.ts", importStmt("@duffel/api"), IMPORTS);
      await expectViolation("src/app/api/example/route.ts", importStmt("@duffel/api"), IMPORTS);
    });

    it("allows @duffel/api inside the Duffel adapter", async () => {
      await expectClean(
        "src/modules/travel-data/adapters/duffel/client.ts",
        importStmt("@duffel/api")
      );
    });
  });

  describe("stateful modules may do I/O", () => {
    it("allows conversation to import @/lib/db", async () => {
      await expectClean("src/modules/conversation/repository.ts", importStmt("@/lib/db"));
    });
  });
});
