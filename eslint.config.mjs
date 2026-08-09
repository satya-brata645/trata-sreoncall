import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * The lint config this repo never had.
 *
 * `npm run lint` calls bare `eslint`, and under flat config v9 that means "find
 * a config file" — of which there was none: no `eslint.config.*`, no
 * `.eslintrc*`, no `eslintConfig` key. The script had therefore never run once,
 * so the `react-hooks` rules that comments in `useAmbientAgent` and `ChatApp`
 * explicitly reason about (and disable by name) were enforced by nothing.
 *
 * `eslint-config-next@16` ships flat configs as its default exports, so they
 * spread straight in — no `FlatCompat` shim.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      // Vendored third-party source, not this app's code.
      "references/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Prefixed arguments are this codebase's existing way of saying
      // "required by the signature, deliberately unused" — `(_error, fatal)`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // The two React Compiler rules the codebase predates, kept visible but
      // not fatal.
      //
      // `refs` objects to `ref.current = latest` during render, which is the
      // pattern this app uses everywhere it needs a callback to see the current
      // props without resubscribing — the desktop controller, the chat
      // composer, the mic session. Adopting the rule properly means moving each
      // of those into an effect, which is a real change in ordering and worth
      // doing deliberately rather than as a side effect of turning linting on
      // for the first time.
      //
      // `set-state-in-effect` objects to the mount-time capability probes
      // (`setSupported(isMicSupported())`), which cannot be computed during
      // render because they touch `window`.
      //
      // Warnings, so they are reported and countable, and so a real error in
      // this file's other rules is not buried under them.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
