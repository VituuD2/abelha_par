import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "tests/**",
      "scripts/**",
      "next-env.d.ts",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  // Legacy code uses permissive provider payload types. TypeScript still validates all sources.
  { rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    // Legacy React hooks code is fixed incrementally.
    "react-hooks/refs": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/purity": "warn",
  } },
];
