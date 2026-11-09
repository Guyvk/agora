# Agora: rules for every AI that works on this code

Read this file before you change anything. It is loaded automatically by Claude Code (through `CLAUDE.md`), Cursor, GitHub Copilot, Codex and most other coding AIs. Where any other file in this repo says something different (Hylo's `CLAUDE.md` sections, `.cursorrules`, `.claude/agents/`), this file wins.

Agora is the online home of 7 Billion Presidents (7BP). It is a copy of [Hylo](https://github.com/Hylozoic/hylo), an open source community platform, with our own additions. Guy van Koolwijk runs it. Guy is not a programmer, so write for him in plain words.

Read next, in this order: `AGORA-STATUS.md` (where things stand), `README-AGORA.md` (what Agora adds and where that code lives). In Anthropic's cloud also read `AGORA-CLOUD.md`.

## Where work goes

- Our repo is `Guyvk/agora`. Its main branch is `agora` (not `dev`, not `main`).
- Never open, comment on, close, label or push anything on `Hylozoic/hylo`, and never upload to its releases. In a local checkout the remote `origin` may point at Hylo: never push there.
- One branch per job, named `<your-name>/<short-name>` (for example `nana/fix-calendar-time`). In Anthropic's cloud, `cloud/<short-name>`.
- Open a **draft** pull request on `Guyvk/agora` with base `agora`. The repo is public, so the pull request is public.
- Never merge, never push to `agora` itself, never force-push, never delete branches you did not make. Guy approves and merges every pull request, and only Guy puts changes live on the server.

## Take work from the build board

- All work lives on the board "Agora build": https://github.com/users/Guyvk/projects/1. Each card is an issue on `Guyvk/agora`.
- Take work from the board. If your job has no card yet, ask Guy or Nana to add one first.
- Link your pull request to its issue: put `Closes #N` in the pull request text (N = the issue number). The card then moves to In review.
- Cards reach Live only when the change is on the live server, not when it is merged. Guy's sessions move them after each server update (`node agora/board-sync.mjs`).
- The board is public: no names of people outside the team, no personal data, no server details on cards. Help desk requests never go on the board by themselves; Guy or Nana writes a short card without names.

## Never

- Passwords, keys or tokens in code, commits, pull requests or chat. If a job needs a real key (speech to text, Claude, kDrive, email), build against a pretend service and say what is missing.
- Real people's data. Only the made-up demo 7BP (`apps/backend/scripts/agora-demo.js`), and only on your own local or cloud database.
- Access to the live server, its settings or its database. If something only happens on the live site, describe it in the pull request.
- Tracking or analytics. `DISABLE_SEGMENT=1` stays.
- Changes to logging in, permissions or how personal data is stored without saying so plainly at the top of the pull request. Such a change needs Guy's OK and a careful review.

## How Agora must behave

- Every menu item and page opens inside the Agora app, in the same page, with the circle menu and top bar still there. Never a separate page or a new tab.
- Nothing in Agora is reachable without logging in, except meeting guest links and the `/terms` and `/privacy` pages.

## How to change code

- Keep changes to Hylo's own files small and mark each with a comment that starts with `Agora:`. Put new things in new files. Add every changed Hylo file to `AGORA-CHANGES.md`.
- A new database migration also goes into `apps/backend/migrations/schema.sql`.
- New texts in the web app go into `apps/web/public/locales` for every language: English first, the others marked for checking if you are unsure.
- Every change comes with a test. Run the tests that touch it before opening the pull request.
- Small pull requests: one fix or one feature each.

## Running Agora and the tests

- Set up once: `./agora/setup-mac.sh` on a Mac, `./agora/setup-cloud.sh` on Linux or in the cloud.
- Start: `./agora/start.sh` (or `./agora/start.sh dev` while changing code), open http://localhost:3000, log in as `steward@agora.test`; the password is in `apps/backend/.agora-demo-login`.
- Web tests: `cd apps/web && yarn test --watchAll=false`.
- Backend tests: `cd apps/backend && yarn test`, always with `DATABASE_URL` pointing at a database whose name ends in `_test`: the tests empty the database they run on.
- Some tests already fail without any change of yours; `AGORA-CLOUD.md` and `AGORA-STATUS.md` list the known ones.

## Writing the pull request

- Plain words, short sentences. Explain a technical term the first time. Never use em dashes.
- Start with two or three sentences on what changes for a 7BP member. Then what you tested and what passed. Then open questions for Guy.
- Do not edit `AGORA-STATUS.md` in job branches; Guy's sessions keep it up to date.
