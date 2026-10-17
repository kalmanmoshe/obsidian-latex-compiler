import typescriptEslintParser from "@typescript-eslint/parser";
import typescriptEslintPlugin from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(

  globalIgnores([
    "node_modules/**",
    "dist/**",
    "cache/**",

    "main.js",
    "src/**/*.js",
    "src/**/*.cjs",
    "src/**/*.mjs",

    "eslint.config.mjs",
    "esbuild.config.mjs",
    "version-bump.mjs",
    "**/*.config.mjs",
    "scripts/**/*.mjs",

    "package.json",
    "package-lock.json",
    "versions.json",
    "tsconfig.json",

    "src/generated/**",
  ]),

  ...obsidianmd.configs.recommended,

  {
    name: "project/typescript",

    files: ["src/**/*.ts", "src/**/*.tsx"],

    languageOptions: {
      parser: typescriptEslintParser,

      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },

      ecmaVersion: "latest",
      sourceType: "module",

      globals: {
        ...globals.browser,
        ...globals.node,

        app: "readonly",
      },
    },

    plugins: {
      "@typescript-eslint": typescriptEslintPlugin,
    },

    rules: {
      "no-unused-vars": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-function": "off",
      
      "no-prototype-builtins": "off",
      "no-undef": "off",
      quotes: "off",
    },
  },
);
