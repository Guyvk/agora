# Agora: rules for Claude working in the cloud

This file is for a Claude Code session that runs in Anthropic's cloud on a fresh copy of `Guyvk/agora`, with Guy's laptop off. It replaces the private notes that stay on Guy's Mac. Read it before anything else, then read `AGORA-STATUS.md`.

Agora is the online home of 7 Billion Presidents (7BP), a copy of Hylo with our own additions. Guy builds it with Claude. Guy is not a programmer.

## The Hylo guide does not apply as written

`CLAUDE.md` comes from Hylo. Its commands and code conventions are useful. Its parts about tickets, issues, releases and pull requests are not ours:

- Never open, comment on, close or label anything on `Hylozoic/hylo`. Never upload to its releases. Never push to `origin` if it points at Hylo.
- Our work goes to `Guyvk/agora`. Its main branch is `agora`, not `dev`.

## What you may do

- Work on branches named `cloud/<short-name>`, one per job.
- Open **draft** pull requests on `Guyvk/agora` with base `agora`. The repo is public, so a pull request is public. Guy agreed to that on 13 October 2026.
- Never merge, never push to `agora` itself, never force-push, never delete branches you did not make.
- If the branch `agora-cloud-setup` is not yet merged into `agora`, start your branches from it, because it holds this file and the cloud setup.

## Setting up

Run `./agora/setup-cloud.sh`. It installs PostgreSQL 17 with PostGIS, Redis and Node 24, creates the databases `agora` (made-up demo data) and `agora_test`, and writes settings files with fresh made-up secrets. If it fails, fixing it is your first job.

- Backend tests empty the database they run on. Always run them with `DATABASE_URL` pointing at `agora_test`.
- Web tests: `cd apps/web && yarn test --watchAll=false`. They mock `useParams`.
- On the cloud machine of 13 October the script took about 5 minutes the first time and 30 seconds again. It needs only the npm registry, Ubuntu's package mirror and nodejs.org. If PostgreSQL's own package site is blocked, it uses Ubuntu's PostgreSQL 16, which works.
- Tests that already fail on the cloud machine, with no change of ours (13 October). Backend: `UploadController uploading via file parses a multipart request` (no S3 settings), and the two `Media` tests (they download a Vimeo picture, which the cloud network blocks; the failed download also makes four later tests fail with `ECONNRESET` in a full run, though they pass alone). Web: `mixpanelMiddleware` (three tests, they expect a Mixpanel token, Agora has none by design), and two `MapExplorer.store` snapshot tests (the saved snapshot lacks the `afterTime` query field).
- Start Agora with `./agora/start.sh` and log in as `steward@agora.test`; the password is in `apps/backend/.agora-demo-login`.

## Never

- Passwords, keys or tokens in code, commits, pull requests or chat. There are no real keys in the cloud, and none should be added. If a job needs a real key (speech to text, Claude, Google Drive, Brevo, Signal), build it against a pretend service and say what is missing.
- Real people's data. Only the made-up demo 7BP. Never run `scripts/agora-demo.js` against anything but the local cloud database.
- Tracking. `DISABLE_SEGMENT=1` stays, and no analytics or support chat is added.
- Changes to logging in, permissions or how personal data is stored, without saying so plainly at the top of the pull request: such a change needs Guy's OK and a review by an experienced developer.
- Putting Agora online, sending real email or messages, spending money.

## How to change code

- Keep changes to Hylo's own files small and mark each with a comment that starts with `Agora:`. Put new things in new files. Add every changed Hylo file to `AGORA-CHANGES.md`.
- A new database migration must also go into `apps/backend/migrations/schema.sql`.
- New texts in the web app go into `apps/web/public/locales` for every language; English first, the others marked for checking if you are unsure.
- Every change comes with a test. Run the tests that touch it before opening the pull request, and say in the pull request what you ran and what passed.

## Writing for Guy

- Plain words. Explain a technical term the first time. Short.
- Never use em dashes, anywhere.
- Each pull request starts with two or three sentences on what changes for a 7BP member, then what was tested, then open questions for Guy.

## At the end of a session

Do not edit `AGORA-STATUS.md` in your job branches, so the pull requests do not collide. Instead, open one last small draft pull request `cloud/handover-<date>` that updates `AGORA-STATUS.md`: what you did (with the pull request numbers), what is unfinished, and the next step. Replace old facts instead of adding to a log, and change the "Last updated" line.
