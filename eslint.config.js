import path from "node:path";

import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const writePaths = [
  {
    owner: "src/lib/server/seen-list.ts",
    selector:
      "CallExpression[callee.property.name=/^(insert|update|delete)$/][arguments.0.name='seenMovies']",
    message:
      "Change seen lists only through #lib/server/seen-list.ts (it bumps users.seen_version).",
  },
  {
    owner: "src/lib/server/groups.ts",
    selector:
      "CallExpression[callee.property.name=/^(insert|update|delete)$/][arguments.0.name=/^(groups|groupMembers|inviteLookupLimits)$/]",
    message:
      "Change groups only through #lib/server/groups.ts (it locks the group and logs the action).",
  },
  {
    owner: "src/lib/server/group-deck.ts",
    selector:
      "CallExpression[callee.property.name=/^(insert|update|delete)$/][arguments.0.name=/^(notSeenMovies|groupWatchedMovies)$/]",
    message:
      "Change Not seen answers and watched movies only through #lib/server/group-deck.ts (it logs the action and bumps the counters polling reads).",
  },
  {
    owner: "src/lib/server/actions.ts",
    selector:
      "CallExpression[callee.property.name=/^(insert|update|delete)$/][arguments.0.name='actions']",
    message:
      "Write the actions log only through runAction in #lib/server/actions.ts.",
  },
];

function writePathBlocks() {
  const restrict = (paths) => ({
    "no-restricted-syntax": [
      "error",
      ...paths.map(({ selector, message }) => ({ selector, message })),
    ],
  });
  return [
    {
      files: ["src/**/*.ts", "src/**/*.svelte", "scripts/**/*.ts"],
      ignores: [
        ...writePaths.flatMap(({ owner }) => (owner === null ? [] : [owner])),
        "src/**/*.spec.ts",
        "src/**/*.e2e.ts",
        "src/lib/server/testing/**",
      ],
      rules: restrict(writePaths),
    },
    ...writePaths.flatMap(({ owner }) =>
      owner === null
        ? []
        : [
            {
              files: [owner],
              rules: restrict(
                writePaths.filter((path) => path.owner !== owner)
              ),
            },
          ]
    ),
  ];
}

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  // "Type-checked" configs use TypeScript's type information, so they can catch
  // things plain linting can't: unsafe `any` usage, unhandled promises, impossible conditions.
  ts.configs.strictTypeChecked,
  ts.configs.stylisticTypeChecked,
  svelte.configs.recommended,
  // oxfmt owns formatting. These configs only switch off ESLint's style rules so the two never
  // disagree (they're named after Prettier, but work with any formatter).
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        // Lets typescript-eslint find the right tsconfig for each file automatically.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
    },
    rules: {
      // TypeScript already reports undefined variables, and more accurately.
      // https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      "no-undef": "off",
      // Kit 2 modules removed in Kit 3. The type check also fails on these,
      // but its "cannot find module" error doesn't name the replacement.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "$app/environment", message: "Kit 3: use $app/env." },
            { name: "$app/stores", message: "Kit 3: use $app/state." },
            // The package root re-exports every icon, which Vite then
            // processes in dev and on every build.
            {
              name: "@lucide/svelte",
              message:
                'Import each icon from its own path: import XIcon from "@lucide/svelte/icons/x".',
            },
          ],
          patterns: [
            {
              regex: "^\\$lib(/|$)",
              message: "Kit 3: import from #lib/... with a file extension.",
            },
          ],
        },
      ],
    },
  },
  // One write path per table, so every change bumps its counters and is
  // logged as an action (AGENTS.md "Architecture rules"). Tests may write
  // fixtures directly. Each owner module is exempt from its own rule only:
  // flat config doesn't merge one rule's options across blocks, so every
  // owner gets a block listing the other rules.
  ...writePathBlocks(),
  {
    // Inside .svelte files, the <script lang="ts"> block is parsed with the TypeScript parser.
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    // Plain JS config files aren't part of the TypeScript project, so skip type-aware rules there.
    files: ["**/*.js"],
    extends: [ts.configs.disableTypeChecked],
  }
);
