import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  js.configs.recommended,

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
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
