import solid from "eslint-plugin-solid/configs/typescript";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import * as tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    plugins: {
      ...solid.plugins,
      "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Include solid's recommended rules as a base
      ...solid.rules,

      // SolidJS-specific (from eslint-plugin-solid)
      "solid/reactivity": "warn",
      "solid/no-destructure": "warn",
      "solid/jsx-no-undef": "error",
      "solid/no-react-specific-props": "error",
      "solid/prefer-for": "warn",

      // TypeScript
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",

      // General quality
      "no-console": "off", // TUI app, console is fine
      "no-constant-condition": "error",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["error", "always"],

      // Catch variable-used-before-initialization bugs (e.g., dims() before const dims = ...)
      "@typescript-eslint/no-use-before-define": ["error", {
        functions: false,  // hoisted function declarations are fine
        classes: true,
        variables: true,
        allowNamedExports: false,
      }],
    },
  },
  {
    // Test files can be more relaxed
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["node_modules/", "dist/", ".claude/", "spike/"],
  },
];
