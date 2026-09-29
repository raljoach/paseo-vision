import nextConfig from "eslint-config-next/core-web-vitals";

// ---------------------------------------------------------------------------
// Module boundaries (PLAN.md §3). See src/modules/README.md.
//
// In flat config, when several config objects match a file and set the same
// rule, the LAST one wins wholesale (options are not merged). The complete
// `no-restricted-imports` options for each file scope are therefore built by
// one helper, and every scope below uses non-overlapping `files`/`ignores`.
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = "{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

const MODULES = [
  "conversation",
  "agents",
  "trip-planning",
  "decision-engine",
  "destinations",
  "travel-data",
  "trips",
  "analytics",
  "auth",
  "privacy",
];

/** Pure modules: no I/O, no LLM, clock/RNG/config injected (PLAN §3, §9). */
const PURE_MODULES = ["trip-planning", "decision-engine", "destinations"];

/** Sub-directories allowed to import a vendor SDK (PLAN §3, §8). */
const OPENAI_ADAPTER_DIR = "src/modules/agents/llm/openai";
const DUFFEL_ADAPTER_DIR = "src/modules/travel-data/adapters/duffel";

const TRAVEL_DATA_PORTS = "@/modules/travel-data/ports";

/** Escape a string for literal use inside a RegExp source. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sourceGlob = (dir) => `${dir}/**/*.${SOURCE_EXTENSIONS}`;

/**
 * Builds the complete `no-restricted-imports` options for one file scope.
 *
 * @param {object} scope
 * @param {string | null} scope.module  Owning module, or null for code outside src/modules.
 * @param {boolean} [scope.allowOpenAI] Scope may import the OpenAI SDK.
 * @param {boolean} [scope.allowDuffel] Scope may import the Duffel SDK.
 */
function buildRestrictedImports({ module, allowOpenAI = false, allowDuffel = false }) {
  const paths = [];
  const patterns = [];
  const otherModules = MODULES.filter((name) => name !== module);
  const ownModuleGuard = module ? `(?!${escapeRegex(module)}(?:/|$))` : "";

  // (a) Public API only: `@/modules/<name>` (its index) or the public
  // `@/modules/travel-data/ports` subpath. Deep imports reach into internals,
  // including another module's DB tables.
  patterns.push({
    regex: `^@/modules/${ownModuleGuard}(?!travel-data/ports$)[^/]+/.+`,
    message:
      "Import other modules only through their public API (`@/modules/<name>`, or `@/modules/travel-data/ports`). Deep imports are forbidden (PLAN §3 Module boundaries).",
  });

  // (a) Cross-module imports must use the `@/modules/...` alias. Relative
  // paths that climb into another module (or into src/modules from outside)
  // would bypass the public-API rule above.
  if (module) {
    patterns.push({
      regex: `^(?:\\.\\./)+(?:modules/)?(?:${otherModules.map(escapeRegex).join("|")})(?:/|$)`,
      message:
        "Do not reach into another module with a relative path; import its public API via `@/modules/<name>` (PLAN §3 Module boundaries).",
    });
    patterns.push({
      regex: "^(?:\\.\\./)+(?:modules|lib|app|components|hooks)(?:/|$)",
      message:
        "Leave the module through the `@/` alias, not a relative path, so boundary rules can be enforced (PLAN §3 Module boundaries).",
    });
  } else {
    patterns.push({
      regex: "^\\.{1,2}/(?:.*/)?modules(?:/|$)",
      message:
        "Import modules via `@/modules/<name>`, not a relative path (PLAN §3 Module boundaries).",
    });
  }

  // (d) OpenAI SDK only inside the LlmPort's OpenAI adapter.
  if (!allowOpenAI) {
    patterns.push({
      regex: "^(?:openai|@ai-sdk/openai)(?:/.*)?$",
      message:
        "The OpenAI SDK may only be imported in src/modules/agents/llm/openai; depend on the LlmPort instead (PLAN §3, §8).",
    });
  }
  if (module) {
    patterns.push({
      regex: "^@openrouter/",
      message: "LLM SDKs are not used directly in modules; depend on the LlmPort (PLAN §3, §8).",
    });
  }

  // (e) Duffel SDK only inside the Duffel adapter.
  if (!allowDuffel) {
    patterns.push({
      regex: "^@duffel/",
      message:
        "The Duffel SDK may only be imported in src/modules/travel-data/adapters/duffel; depend on the FlightProvider port instead (PLAN §3, §8).",
    });
  }

  // (b)(c) Pure modules: no I/O, framework, LLM or DB; only other pure
  // modules and (decision-engine only) travel-data ports.
  if (module && PURE_MODULES.includes(module)) {
    const pureMessage = (what) =>
      `Pure module (${module}) must not import ${what}: no I/O, no LLM, no framework; clock/RNG/config must be injected (PLAN §3, §9 Determinism).`;

    for (const name of ["@/lib/db", "@/lib/schema", "@/lib/storage"]) {
      paths.push({ name, message: pureMessage("database/storage code") });
    }
    for (const name of ["@/lib/auth", "@/lib/auth-client", "@/lib/session"]) {
      paths.push({ name, message: pureMessage("auth/session code") });
    }
    paths.push({ name: "@/lib/env", message: pureMessage("env config (pass config in)") });

    for (const name of MODULES.filter((m) => !PURE_MODULES.includes(m))) {
      paths.push({
        name: `@/modules/${name}`,
        message: pureMessage(`stateful module \`${name}\``),
      });
    }
    // decision-engine may use `@/modules/travel-data/ports`; adapters are
    // covered by the deep-import rule and the travel-data root is banned above.
    if (module !== "decision-engine") {
      paths.push({
        name: TRAVEL_DATA_PORTS,
        message: pureMessage("travel-data ports (only decision-engine may)"),
      });
    }

    patterns.push(
      {
        regex: "^(?:drizzle-orm|postgres|pg|better-auth)(?:/.*)?$",
        message: pureMessage("database/auth libraries"),
      },
      {
        regex: "^(?:next|react|react-dom)(?:/.*)?$",
        message: pureMessage("framework code"),
      },
      {
        regex: "^(?:ai(?:/.*)?|@ai-sdk/.*|openai(?:/.*)?)$",
        message: pureMessage("LLM SDKs"),
      },
      {
        regex: "^@vercel/",
        message: pureMessage("platform SDKs"),
      },
      {
        regex: "^(?:node:.*|(?:fs|http|https|child_process|net)(?:/.*)?)$",
        message: pureMessage("Node I/O modules"),
      }
    );
  }

  return ["error", { paths, patterns }];
}

const DETERMINISM_MESSAGE = "clock/RNG/config must be injected (PLAN §3, §9 Determinism).";

/** `no-restricted-syntax` for pure modules (PLAN §9 Determinism). */
const PURE_SYNTAX_RULE = [
  "error",
  ...[
    ["CallExpression[callee.object.name='Date'][callee.property.name='now']", "Date.now()"],
    ["NewExpression[callee.name='Date'][arguments.length=0]", "new Date() without arguments"],
    ["CallExpression[callee.name='Date']", "Date() (returns the current time)"],
    ["CallExpression[callee.object.name='Math'][callee.property.name='random']", "Math.random()"],
    [
      "CallExpression[callee.object.name='crypto'][callee.property.name=/^(randomUUID|getRandomValues)$/]",
      "crypto randomness",
    ],
    [
      "CallExpression[callee.object.name='performance'][callee.property.name='now']",
      "performance.now()",
    ],
    ["MemberExpression[object.name='process'][property.name='env']", "process.env"],
    ["CallExpression[callee.name='fetch']", "global fetch()"],
    [
      "CallExpression[callee.object.name=/^(globalThis|window|self)$/][callee.property.name='fetch']",
      "global fetch()",
    ],
  ].map(([selector, what]) => ({
    selector,
    message: `${what} is not allowed in pure modules: ${DETERMINISM_MESSAGE}`,
  })),
];

/** Sub-scopes carved out of their parent module scope (SDK adapters). */
const SUB_SCOPES = [
  { module: "agents", dir: OPENAI_ADAPTER_DIR, allowOpenAI: true },
  { module: "travel-data", dir: DUFFEL_ADAPTER_DIR, allowDuffel: true },
];

const moduleBoundaryConfigs = [
  // Code outside src/modules (app, components, lib, hooks, proxy, ...).
  {
    name: "paseo/module-boundaries/outside-modules",
    files: [sourceGlob("src")],
    ignores: [sourceGlob("src/modules")],
    rules: { "no-restricted-imports": buildRestrictedImports({ module: null }) },
  },
  // One scope per module, excluding its SDK adapter sub-scopes.
  ...MODULES.map((module) => {
    const dir = `src/modules/${module}`;
    const rules = { "no-restricted-imports": buildRestrictedImports({ module }) };
    if (PURE_MODULES.includes(module)) {
      rules["no-restricted-syntax"] = PURE_SYNTAX_RULE;
    }
    return {
      name: `paseo/module-boundaries/${module}`,
      files: [sourceGlob(dir)],
      ignores: SUB_SCOPES.filter((s) => s.module === module).map((s) => sourceGlob(s.dir)),
      rules,
    };
  }),
  ...SUB_SCOPES.map(({ module, dir, allowOpenAI, allowDuffel }) => ({
    name: `paseo/module-boundaries/${dir.replace("src/modules/", "")}`,
    files: [sourceGlob(dir)],
    rules: {
      "no-restricted-imports": buildRestrictedImports({ module, allowOpenAI, allowDuffel }),
    },
  })),
];

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".cache/**",
      "dist/**",
      "build/**",
      "create-agentic-app/**",
      "drizzle/**",
      "scripts/**",
    ],
  },
  ...nextConfig,
  {
    rules: {
      // React rules
      "react/jsx-no-target-blank": "error",
      "react/no-unescaped-entities": "off",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Import rules
      "import/no-anonymous-default-export": "warn",
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling"], "index", "type"],
          pathGroups: [
            {
              pattern: "react",
              group: "builtin",
              position: "before",
            },
            {
              pattern: "next/**",
              group: "builtin",
              position: "before",
            },
            {
              pattern: "@/**",
              group: "internal",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["react", "next"],
          "newlines-between": "never",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],

      // Best practices
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  ...moduleBoundaryConfigs,
];

export default config;
