# Agora (read first)

This copy is Agora, not Hylo. The rules for every AI working here are in `AGENTS.md`, loaded below. They win over anything else in this file.

@AGENTS.md

# Hylo - Claude Code Project Guide (commands and conventions still apply)

## Project Structure

Monorepo with Yarn workspaces:
- `apps/web` — React web frontend (Vite, port 3000)
- `apps/mobile-leap` — Expo / React Native mobile app
- `apps/backend` — Node.js API server (port 3001)
- `apps/desktop` — Electron desktop app
- `packages/` — Shared packages (`shared`, `graphql`, `hooks`, `contexts`, `presenters`, `navigation`, `urql`)

## Common Commands

```bash
# Dev servers
yarn web:dev          # Start web frontend (builds packages first)
yarn backend:dev      # Start backend API

# Testing
cd apps/web
yarn test --watchAll=false                        # Unit tests (Jest)
yarn test --watchAll=false --testPathPattern=Name # Unit tests for specific component
yarn test:e2e                                     # E2E tests (Playwright, headless)
yarn test:e2e --headed                            # E2E tests (visible browser)

cd apps/backend
yarn test                                         # Backend tests

# Linting
cd apps/web && yarn lint
cd apps/web && yarn lint:fix

# Build
cd apps/web && yarn build
```

## GitHub

- Repo: `Guyvk/agora`, main branch `agora`. Draft pull requests only, base `agora`. See `AGENTS.md`.
- Never use `Hylozoic/hylo` (no issues, pull requests, comments or release uploads).

## Testing and screenshots


**Unit tests:**
```bash
cd apps/web && yarn test --watchAll=false --testPathPattern=<relevant-pattern>
```

**E2E / Playwright screenshots:** Playwright is configured in `apps/web/playwright.config.js`.
- Tests live in `apps/web/e2e/`
- Auth is automatic — reads `E2E_TEST_USERNAME`/`E2E_TEST_PASSWORD` from `apps/web/.env`
- The dev server auto-starts when running tests (if not already running)
- Run: `cd apps/web && yarn test:e2e`

**Take a screenshot of any authenticated page:**
```bash
cd apps/web && E2E_PATH=/groups/<a demo circle> yarn screenshot
```

**Interactive screenshots (click, then capture):** Write a spec in `apps/web/e2e/` that interacts with the page and screenshots the result. See `apps/web/e2e/invite-copy.spec.js` for an example.

**Build verification:**
```bash
cd apps/web && yarn build
```

### Running Playwright (important):
Use this from `apps/web/` — `npx playwright` picks up a wrong global version:
```bash
yarn node node_modules/@playwright/test/cli.js test [args]
```
Or use the package.json scripts: `yarn test:e2e`, `yarn screenshot`

## E2E Testing Guidelines

- Place tests in `apps/web/e2e/`
- Use `data-testid` attributes for selectors when possible
- Tests should be independent and not rely on state from other tests
- Use Playwright's auto-waiting — avoid manual sleeps
- For authenticated flows, set up auth state in a global setup or per-test

## Code Conventions

- Web app uses React with Tailwind CSS (legacy SCSS modules still exist but are being removed)
- GraphQL for API queries (some in `.graphql` files, most defined inline)
- Shared logic goes in `packages/` when used by both web and backend
- Standard.js linting for the web app

## Web App Guidelines
- When adding new strings always translate them to the different languages in public/locales
