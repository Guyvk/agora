# Coding on Agora with your AI

Last updated 9 November 2026.

This is how you and your AI coding assistant can work on Agora's code. You work with made-up demo data, your AI opens a pull request, and Guy approves it before anything goes live.

## Easiest: work in your browser (nothing to download)

If you use Claude, you can skip the setup on your own computer. Claude Code on the web runs a copy of Agora in the cloud for you.

1. Ask Guy to add you as a collaborator on [github.com/Guyvk/agora](https://github.com/Guyvk/agora) (send him your GitHub username), and accept the invitation email from GitHub.
2. Go to [claude.ai/code](https://claude.ai/code) and log in with your own Claude account (a paid plan is needed).
3. Connect your GitHub account when it asks, and pick the repository `Guyvk/agora`, branch `agora`.
4. Start a session and type your task. The first time, add: "Run ./agora/setup-cloud.sh first." The rules load by themselves.
5. Claude sets up Agora with demo data (about 5 minutes the first time), makes the change, runs the tests and opens a draft pull request on Guyvk/agora.
6. Tell Guy the pull request is ready. He approves it and puts it live.

You can close the browser while Claude works and come back to the session later. The steps in "Step by step: run Agora on your computer" below are only needed if you want Agora on your own laptop.

## What you need

| What | Details |
| --- | --- |
| A computer | A Mac is easiest: there is a one-command setup. Linux (Ubuntu) works with the cloud setup script. Windows: use WSL with Ubuntu (not tried yet). About 10 GB free disk space. Not needed for the browser option above. |
| A GitHub account | Send Guy your GitHub username so he can give you access. |
| Your AI coding tool | Any tool that can read a code folder and run commands: Claude Code, Cursor, Copilot, Aider with your own model, and so on. |
| Git | On a Mac: run `xcode-select --install` once in the Terminal. |
| Time | First setup takes 10 to 20 minutes. After that Agora starts in about 30 seconds. |

The code is public: [github.com/Guyvk/agora](https://github.com/Guyvk/agora). Its main branch is called `agora`, not `main` or `dev`.

## Step by step: run Agora on your computer

You can do these steps yourself, or ask your AI to do them for you.

1. Get the code. In the Terminal:

   ```
   git clone https://github.com/Guyvk/agora.git
   cd agora
   git checkout agora
   ```
2. Set everything up (database, tools, demo data):
   - Mac: `./agora/setup-mac.sh`
   - Linux or WSL: `./agora/setup-cloud.sh`
3. Start Agora: `./agora/start.sh` (or `./agora/start.sh dev` while changing code, so changes show up as you save).
4. Open http://localhost:3000 and log in as `steward@agora.test`. The password is in the file `apps/backend/.agora-demo-login`.
5. Check the tests run before you change anything:
   - Web: `cd apps/web && yarn test --watchAll=false`
   - Backend: `cd apps/backend && yarn test`, with `DATABASE_URL` pointing at the `agora_test` database (backend tests empty the database they run on).

If a step fails, the message on screen says which step. Paste it to your AI, or send it to Guy. Background reading: `README-AGORA.md` explains what Agora adds to Hylo and where that code lives.

## Your AI already knows the rules

You do not need to paste anything. Agora's rules for AIs live in the code, in the file [`AGENTS.md`](../AGENTS.md), and your AI reads them by itself at the start of every session. Claude reads them through `CLAUDE.md`, Cursor through `.cursorrules`, Copilot through `.github/copilot-instructions.md`, and most other tools read `AGENTS.md` directly.

The rules cover: our repo and branch, draft pull requests only, never Hylo's own GitHub, no real keys or people's data, pages that open inside the app, login required, a test with every change, and pull requests in plain words.

So a session starts with just your task, for example: "Fix the time shown on the calendar page for meetings after the clock change. Open a draft pull request when done."

If you use a tool that does not read these files, tell it once at the start: "Read AGENTS.md first and follow it."

## The build board

Everything we build is a card on the board **Agora build**: [github.com/users/Guyvk/projects/1](https://github.com/users/Guyvk/projects/1). Guy, Nana, your AI and Claude's builders all use this one list.

| Column | Means |
| --- | --- |
| To do | Nobody has started |
| Doing | Someone is building it (put your name in Owner) |
| In review | A pull request is open, or merged but not on the server yet |
| Live | On the live Agora |

- Pick a card, set Owner to your name and move it to Doing.
- Tell your AI the issue number, for example: "Work on issue #88. Put Closes #88 in the pull request." The card then moves to In review by itself.
- After Guy puts the change live, the card moves to Live.
- No card for your idea yet? Add one with a short title and a few plain sentences. The board is public: no names of people outside the team and no personal details.

## How a change reaches Agora

Nothing you or your AI do can reach the live Agora directly. Every change passes Guy first.

1. You pick a card from the build board and give your AI the task (a fix from the Help desk, a wish from a meeting).
2. Your AI makes a branch `<your-name>/<short-name>`, writes the code and the test, and tries it with demo data.
3. Your AI opens a draft pull request on Guyvk/agora. You read it and try it once yourself.
4. You tell Guy it is ready. Guy reviews it and asks questions in the pull request if needed.
5. Guy merges it and puts it live on the server, outside meeting times.

Pick small jobs to start with: one fix or one small feature per pull request is far easier to review than a big one.

## Never

- No access to the live server. You and your AI never need the server login or its settings file. If something only shows up on the live site, describe it to Guy.
- No real keys in the code, a commit, a pull request or a chat with your AI: speech to text, Claude, kDrive, email. Build against a pretend service and say what is missing.
- No real people's data on your computer. Only the made-up demo 7BP.
- No tracking or analytics added.
- The repo is public: everything in a pull request can be read by anyone.
