# Agora: where we are

This is the handover note. Whoever works on Agora, a person or Claude, reads it first and updates it before stopping. Keep it short and plain. Replace old facts instead of adding to a log.

**Last updated:** 17 October 2026, about 22:00, by Claude Code on the Mac. The Mac now runs everything merged on GitHub (#1 to #7), plus the build fix in #8, merged the same evening.

## What Agora is

Agora is the online home of 7 Billion Presidents (7BP): about forty volunteers, organised in circles. It is our own copy of Hylo, with our own additions. Guy builds it with Claude. It will live at agora.7billionpresidents.org. Nothing is online yet.

## Where things are written down

| What | Where |
| --- | --- |
| The plan, the decisions, every idea and the open questions for the founder | The doc "Agora Build Plan": https://claude.ai/code/artifact/e7ccd166-f04e-42bb-bc8d-6a90c6e9a1ad. A text copy is `build-plan.md` in the main folder. The doc is the master |
| What is done, what is half done, what comes next | This file |
| What Agora adds to Hylo and how to run it | `README-AGORA.md` |
| Every Hylo file we changed | `AGORA-CHANGES.md` |
| Ideas seen in Iberozoa's app (iberozoa.app), ranked for Agora, 12 October | `ideas-from-iberozoa.md` |

## Done

Built on 11 October 2026 in Claude's cloud workspace, on top of Hylo `dev` at commit `58f7666`:

- Agora starts from an empty database with a made-up 7BP: six circles, six people, sample playbook proposals, two events.
- Meeting room that writes its own minutes, at `/noo/meeting/<event id>/room`.
- Our own email sender (eight texts; prints emails in the Terminal unless Brevo is set).
- The name Agora in the browser title and the English texts. Other languages still say Hylo.
- No tracking, no Hylo landing site.
- Setup and start scripts, README, change list, seven small tests.

On this Mac (2017 Intel MacBook, macOS 13), confirmed on 12 October:

- Agora runs at http://localhost:3000 from the main folder, started with `./agora/start.sh`, and Guy has used it in his browser.
- 17 October: the main folder was moved to GitHub's `agora` branch (#1 to #7 merged), the Drive table was added to the `agora` database, and Agora was restarted. The main folder is back on branch `agora`, equal to GitHub after #8. The old local commit (Iberozoa ideas and an older note) is kept in branch `agora-mac-backup-2026-10-17`; `ideas-from-iberozoa.md` stays on disk, hidden from git by `.git/info/exclude`. A backup of the demo database from before is `agora-before-update.dump` in the Claude job folder. The working copies under `.claude/worktrees` are all merged and can be removed. The code is on GitHub as `Guyvk/agora` (public, main branch `agora`). `ideas-from-iberozoa.md` stays on the Mac only: it describes a members-only app.
- Tools, all without Homebrew, which builds everything from source on macOS 13: Postgres.app with PostgreSQL 17 and PostGIS in Applications, Node 24 in `~/.local/share/agora-node24`, Redis built from source in `~/.local/share/agora-redis`. Databases: `agora` with the demo data, and `agora_test`, which the tests empty every time.
- Committed on `agora-mac-setup`, each one tested:
  - `50c985f` The setup script uses Postgres.app, Node from nodejs.org and Redis from source. It ran twice from scratch. The build of an old picture tool (sharp 0.32.6) is skipped in `package.json`.
  - `c59cf80` An event without a video call link gets its Agora meeting room as its link.
  - `74530a1` A Files page per circle that lists its Google Drive folder, read only. Tested with a pretend Drive only: there is no Google robot account yet.
  - `9895ec9` The Commons (Hylo's public area) is hidden. One switch in `apps/web/src/agora/config.js` brings it back.
  - `88da613` Without speech to text, the meeting room records nothing and says so, instead of promising minutes.
  - `e6f7373` The background worker, which writes the minutes, no longer stops itself on this Mac.
  - `a452bb9` `./agora/start.sh` opens Agora fast: a ready-built web app and no restarts. A page loads in under a second instead of about 30. `./agora/start.sh dev` is for changing code.
  - `0015cdc` `build-plan.md` and `CLAUDE.local.md` are kept out of git.
  - `44bd452` A shared Contacts page (a small CRM), with a button in the left bar. Chosen with Guy on 12 October: one list for everyone, partners, press, funders and interested people, notes, follow-ups, a change log, every Agora member can edit. Only five made-up demo contacts are in it. Real contacts wait for a privacy review (see README, "Contacts"). In the main folder and running.
  - `4e12d75` Tests keep their background jobs in their own queue (`q-test`). Before this, test runs leaked jobs into the running Agora, which added about 150 extra activities and notifications and a few event invitations to the demo data on 12 October.
  - `bf4f8fd` The Delete tab of a circle's settings says when deleting failed, instead of doing nothing.
  - `37ffc40` The Contacts page is part of the app at `/contacts`, like Messages: the left bar stays, it looks like the rest of Agora, nothing reloads, and each contact has its own address. The loading screen shows the 7BP mark and the word Agora.
- Cleaned on 12 October: the 153 activities, 152 notifications and 6 event invitations that leaked test jobs added to the demo data, and the unread counters they raised. Guy's own chat message stayed. A backup from before is in the Claude job folder (`agora-before-cleanup.dump`).
- Guy tried to delete the Network circle and it stayed. Demo Steward is allowed to, and Hylo's delete works (tried and rolled back). Most likely the confirmation box was closed without clicking OK. Network is still there.
- Guy held a test meeting. No minutes came, because speech to text is not connected: there are no keys in `apps/backend/.env` yet.
- Unfinished: the keys for speech to text, Claude and Google Drive are missing.

## Cloud sessions

Done in the first cloud session (13 to 14 October), all merged on 13 October:

- #1 `agora-cloud-setup`: `./agora/setup-cloud.sh` works on the cloud machine (5 minutes the first time, 30 seconds again). Test results are in the comment on #1: backend 7 failing, web 6 failing, none caused by us (a blocked Vimeo download, missing upload settings, tests that expect a Mixpanel token, old snapshots). They are listed in `AGORA-CLOUD.md`.
- #2 `cloud/cookie-and-login`: the cookie notice and login page no longer show Hylo's services or logo. Waits for Guy: Terms and Privacy links still point to hylo.com, and the translations need a native check.
- #3 `cloud/hide-commons-mentions`: no more words about The Commons while it is off. Waits for Guy: should "public posts" stay?

Merged on 17 October, made in a Mac chat:

- #5 Email texts for events, posts, mentions and digests, and sending through any mail server (SMTP).
- #6 Circle members add files to Google Drive (off unless `AGORA_DRIVE_UPLOADS=on`). An administrator links each circle's folder with `scripts/agora-drive-link.js`.
- #7 Agora on its own server at Infomaniak (VPS Lite M, Switzerland) instead of Heroku: `agora/vps/`. Not yet run on a real server.

#8 `agora-fix-web-build` (merged 17 October). After #2 and #3 the web app no longer built (imports written `agora/...` instead of `@/agora/...`), so `./agora/start.sh` failed. Fixed and tested on the Mac: build works, web tests 999 passing and the same 6 known failures, Agora backend tests 86 passing, the login page opens without errors.

In the cloud, nothing was started in a browser in the cloud and ESLint does not start in this repo (its config does not fit ESLint 9).

## Not tested yet

Real voices and real microphones. The kMeet call inside the room with real muting. A summary written by Claude itself. Infomaniak's speech to text: its price per minute, and whether it accepts the sound format the room sends. The Files pages against a real Google Drive. Sending email through Brevo. Phones.

## Next, in this order

**Cloud agents and Signal (Guy's answers, 13 October):** both are written up in the Build Plan doc, sections "Cloud agents" and "Signal". (a) First cloud job: not yet, so no cloud agent is set up. (b) Public draft pull requests on `Guyvk/agora`: yes; the Claude GitHub app still needs access to that repo only. (c) Signal: to figure out with 7BP. Signal's terms forbid "auto-messaging", so the plan suggests option A, a steward pastes an update Agora prepares, and lists B (a bot with its own number), C (not suggested) and D (no connection). Guy then asked for cloud sessions that keep working while the laptop is off, but no nightly timer yet. `AGORA-CLOUD.md` holds the rules for them and `agora/setup-cloud.sh` sets Agora up on a cloud machine. Each cloud session opens draft pull requests on `Guyvk/agora`; Guy merges.

**Jobs a cloud session can do without keys or Guy**, in this order:

1. (Done, #1.) Cloud setup and tests.
2. (Done, #2 and #3.) Cookie notice, login page, Commons mentions.
3. (Done, #5.) Email texts.
4. Translations of the Contacts texts. **Next cloud job.** Before opening a pull request that touches `apps/web`, run the web build (`cd apps/web && node scripts/build.js`): the tests alone missed the broken build.
5. The playbook page (step 9), on demo data.
6. The weekly update (step 8) with a fallback that works without a Claude key, and a "Copy for Signal" button (Signal option A in the Build Plan).
7. A welcome for new volunteers (part of step 12).

2. Before real contacts go into the Contacts page: an experienced developer reviews it, and 7BP agrees who answers when someone asks what is kept about them or asks to be removed.
4. Connect speech to text with Infomaniak (chosen on 12 October; Scaleway in France is the backup). Guy puts the address and key into `apps/backend/.env` himself, plus a Claude key for the summaries. Then one short test recording.
5. Try the meeting room with real voices: three or four people with headphones, ten minutes.
6. Put Agora online on an Infomaniak VPS Lite M, at agora.7billionpresidents.org. The steps are in "Going online" in the README (#7). Costs about 10 euros a month and needs whoever holds the login of the domain, so Guy decides when.
7. Connect Google Drive once Guy has the 7BP Google login. The steps are under "Google Drive" in the README. The Files pages are built.
8. The weekly update written by the assistant. A steward approves it during the first month.
9. A playbook page: every chapter with its owner and status.
10. The weekly update and new decisions also go to the Signal group.
11. The helper in the corner: a chat window at the bottom right that explains Agora, takes questions for the team, and helps people shape an addition they can build themselves.
12. Drafts of accountability reports per circle, a message house section for the communications circle, and a welcome for new volunteers.
13. Uploads stored with Infomaniak's Swiss Backup, with an upload button of our own instead of Filestack. Check first whether Swiss Backup can serve files by link.

Small jobs for in between:

- Offer the fix in `Websockets.js` back to Hylo. That is a public pull request, so ask Guy first.
- The Build Plan doc still says the setup script has not run on a Mac. Correct it: it has, and the demo opened.
- The Terms of Service and Privacy Policy links on the login pages still point to hylo.com. Agora needs its own texts.

## Ideas and where each one stands

| Idea | Status |
| --- | --- |
| Profiles that show who can do what | In Hylo already (profiles with skills) |
| Circles that keep their information open to everyone | In Hylo already (groups inside groups). The demo has six |
| Minutes after every meeting, without anyone switching it on | Built. Needs speech to text (step 3) and the trial with real voices (step 4) |
| AI that keeps track and sends a weekly update | Planned, step 7 |
| Progress on the governance playbook, visible to all | Chapters go in as proposals. The page is step 8 |
| Files in Google Drive, shown inside Agora | Built. Needs the Google robot account, step 6 |
| Everyone can see their tasks | Not designed yet. Hylo has projects, and the minutes list actions |
| A CRM for people outside Agora | Built: the Contacts page. Needs a privacy review before real contacts go in |
| Accountability reports | Planned, step 11 |
| Message house for the communications circle | Planned, step 11 |
| Onboarding for volunteers | Planned, step 11. Hylo has join questions and welcome emails |
| Updates in Signal | Planned, step 10. How it works and what it needs: "Signal" in the Build Plan. Signal forbids bots, so a steward posting what Agora prepares is suggested first. Waits for 7BP |
| Cloud agents that test and fix Agora at night | Written up in the Build Plan, "Cloud agents". Waits for Guy's three choices |
| People build additions on their own computer and offer them as proposals | Described in the README. Try-out copies per proposal are not set up |
| A few people share control | Three key holders for every outside account. In the plan, nothing in the code |
| Helper at the bottom right | Later, step 10 |

## Things we learned the hard way

- The server will not start without `STRIPE_SECRET_KEY`. A placeholder that starts with `sk_test_` is enough.
- `OIDC_KEYS` must be an RSA key in the old PKCS#1 format. `agora/make-env.mjs` makes the right kind.
- A new migration must also be added to `apps/backend/migrations/schema.sql`, because fresh installs load that file and mark all migrations as done.
- Hylo's own sample data fails on the current database. Use `scripts/agora-demo.js`.
- The web app's development server needs about 3 GB of memory and is slow: about 30 seconds for one page on this Mac. `./agora/start.sh` now uses a ready-built copy instead.
- On this Mac, Homebrew has no ready-made packages for macOS 13 and builds from source: 134 packages for PostGIS, and llvm plus Rust for Redis. Use Postgres.app, nodejs.org and Redis from source.
- The server's file watcher (nodemon) runs out of open files on this Mac and then stops the worker, so no minutes get written. `./agora/start.sh dev` sets `CHOKIDAR_USEPOLLING=1`; the normal start uses no watcher.
- Hylo's database tests empty the database they run on. Always run them with `DATABASE_URL` pointing at `agora_test`.
- Tests also put jobs on the Redis queue. They now use their own queue (`q-test`, set in `test/setup/core.js`); without it, the running Agora's worker runs them on the demo data.
- On a cloud machine, postgresql.org and repo.yarnpkg.com are blocked. The cloud script uses Ubuntu's PostgreSQL 16 and fetches Yarn from the npm registry, and `yarn install` needs `YARN_NETWORK_CONCURRENCY=4` because 16 downloads at once drop connections.
- Backend tests leave the `knex_migrations` list of `agora_test` empty, so the setup script only migrates a database whose list has rows.
- Each server program keeps up to 30 database connections open. `DB_POOL_MIN`/`DB_POOL_MAX` (#6) lower that.
- On this Mac, backend tests hang at the start with `DATABASE_URL=postgres://localhost/agora_test`. Use `postgres://guyvk@localhost:5432/agora_test` and run mocha directly: `node node_modules/mocha/bin/mocha -r test/setup/core -r @babel/register --exit --timeout 60000 test/unit/agora/` from `apps/backend`. The `agora_test` migration list is empty, so `yarn migrate` fails there; the tests rebuild it from `schema.sql`.
- Jest finds imports written `agora/...`, the web build does not. Always write `@/agora/...`.
- Playwright has no browser of its own on this Mac. Use the installed Chrome with `chromium.launch({ channel: 'chrome' })`. Hylo's `yarn screenshot` does not work here (it expects a database user `postgres`).
