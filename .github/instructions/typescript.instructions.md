# GitHub Copilot Instructions for TypeScript

## General Guidelines
- Always use **TypeScript** syntax, not plain JavaScript.
- Prefer **ES2020+** features where supported (this project targets Node.js 22+).
- Use Node.js 22 built-in APIs (`fetch`, `crypto`) directly — no need to import them.
- Write **self-documenting code** with clear variable and function names.
- Avoid unnecessary abbreviations.
- Prefer **named exports** over default exports for better refactorability.

## Imports
- Use **`import type`** for type-only imports to avoid unnecessary runtime dependencies.
  ```typescript
  import type { IAuthService } from '../interfaces/IAuthService';
  ```
- Group imports: external modules first, then internal modules, then types.

## Type Safety
- Always use **explicit types** for function parameters and return values.
- Prefer `interface` over `type` for object shapes unless union types are needed.
- Use `readonly` for immutable properties.
- Avoid `any`; use `unknown` or generics instead.
- Use **discriminated unions** with a `kind` literal property for outcome/result types:
  ```typescript
  export type CreateEntryOutcome =
    | { kind: 'created'; issueNumber: number }
    | { kind: 'idempotent'; statusCode: number };
  ```
- Prefer `as const` for enum-like constant objects over TypeScript `enum`.
- Use the **`in` operator** for type narrowing when discriminating object shapes.

## Dependency Injection & Interfaces
- Define service dependencies as **interfaces** (prefix with `I`, e.g., `IAuthService`).
- Inject dependencies via **constructor parameters** typed as interfaces, not concrete classes.
- Declare injected fields as `private readonly`:
  ```typescript
  constructor(
    private readonly auth: IAuthService,
    private readonly github: IGitHubService,
  ) {}
  ```
- This allows easy substitution with test doubles in unit tests.

## Code Style
- Use **camelCase** for variables and functions, **PascalCase** for classes and interfaces.
- Prefer `const` over `let` unless reassignment is required.
- Use arrow functions for callbacks and inline functions.
- Format code according to **Prettier** defaults (2 spaces, semicolons, single quotes).

## Error Handling
- Use `try/catch` for async/await error handling.
- Always type errors as `unknown` and narrow before use:
  ```typescript
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
  }
  ```
- Avoid silent failures — log or handle errors meaningfully.
- Throw meaningful `Error` instances with descriptive messages rather than returning `null`/`undefined` for error states.

## Comments & Documentation
- Add JSDoc comments for public functions, classes, and interfaces.
- Keep comments concise and relevant.

## Testing
- Write unit tests for all exported functions and classes.
- Use **vitest** with TypeScript support (`import { describe, it, expect, vi, beforeEach } from 'vitest'`).
- Tests live under `src/**/*.test.ts` — they are excluded from the production build (`tsconfig.json`) but type-checked via `tsconfig.test.json`.
- Create **factory functions** to build test doubles for interfaces, using `vi.fn()`:
  ```typescript
  function makeAuth(token = 'tok'): IAuthService {
    return { getInstallationToken: vi.fn().mockResolvedValue(token) };
  }
  ```
- Use `Partial<IService>` with spread overrides to keep test doubles concise and flexible.
- Prefer **test doubles over mocking modules** to keep tests decoupled from implementation details.