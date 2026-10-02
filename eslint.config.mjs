import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});
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
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Legacy code uses permissive provider payload types. TypeScript still validates all sources.
  { rules: { "@typescript-eslint/no-explicit-any": "warn" } },
];
