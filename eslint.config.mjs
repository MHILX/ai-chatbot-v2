import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        URL: "readonly",
        fetch: "readonly",
        document: "readonly",
        localStorage: "readonly",
        crypto: "readonly"
      }
    },
    rules: {
      "@typescript-eslint/no-empty-object-type": "off"
    }
  }
];
