import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // These <Image> elements come from @react-pdf/renderer, not the DOM. PDF
  // images have no alt attribute, so jsx-a11y/alt-text does not apply.
  {
    files: ["lib/**/*-pdf.tsx", "lib/pdf.tsx"],
    rules: { "jsx-a11y/alt-text": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
