// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import globals from "globals";

const sharedRules = {
    ...tseslint.configs.recommended.rules,
    "no-undef": "off",
};

export default [
    js.configs.recommended,
    {
        files: ["src/**/*.ts"],
        ignores: ["src/**/*.test.ts", "src/**/*.spec.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: sharedRules,
    },
    {
        files: ["src/**/*.test.ts", "src/**/*.spec.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.test.json",
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: sharedRules,
    },
];

