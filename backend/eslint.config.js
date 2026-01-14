import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // Базовые рекомендации ESLint
  js.configs.recommended,

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",

      // 👇 КЛЮЧЕВОЙ ФИКС: говорим ESLint, что это Node.js среда
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "no-unused-vars": "off", // TypeScript сам лучше знает
      "import/no-unresolved": "off", // в TS/ESM может шуметь без резолвера
    },
  },

  {
    ignores: ["node_modules/**", "dist/**", "prisma/migrations/**"],
  },
];
