# Agora

Agora is the online home of 7 Billion Presidents: one place for circles, people, meetings, decisions and files. It is built on [Hylo](https://github.com/Hylozoic/hylo), an open source community platform, and adds a few things of its own.

"Agora" was the square where the citizens of ancient Greece met to talk and decide. In Portuguese the same word means "now".

This file explains what Agora adds to Hylo, how to run it on a Mac, and how to change it. It is written for people who are not programmers.

## What Agora adds to Hylo

| Addition | What it does | Where the code lives |
| --- | --- | --- |
| Meetings that write their own minutes | Every event has a meeting room, and video calls always go through it (no Zoom or other links). While people speak, their own browser turns their speech into text. When the meeting ends, the assistant posts the minutes in the group. People without an account can join through a guest link | `apps/backend/agora/meeting-room.html`, `api/controllers/MeetingController.js`, `api/controllers/MeetingGuestController.js`, `api/models/Meeting*.js`, `api/services/Transcription.js`, `api/services/MeetingMinutes.js`, `lib/agora/meetingLink.js`, `scripts/agora-meeting-links.js` |
| Our own email sender | Hylo's emails are stored in Hylo's own account, so a copy of Hylo cannot send them. Agora has its own texts for sign-up, password reset, invitations, join requests, new posts and mentions, event invitations and replies (with the calendar file), and the daily and weekly digest. Reply addresses that only Hylo's mail server reads are left out. Sends through Brevo or through any mail server (SMTP), such as a 7BP mailbox | `apps/backend/lib/agora/mailer.js` |
| Our own name | The browser title, the loading screen (with the 7 Billion Presidents mark) and the English texts say Agora | `apps/web/public/locales/en.json`, `apps/web/index.html`, `apps/web/public/agora-7bp-logo.png` |
| No landing site | Visitors who are not logged in go straight to the login page | `apps/web/src/server/proxy.js` |
| Each circle's files in kDrive | A Files page per circle shows its own folder in 7BP's kDrive at Infomaniak. Members of the circle open folders, download, add files and make folders; whoever added something, and the stewards, rename and delete it. Members can also add a link to a Google Doc, Sheet, Slides, Form or Drive file. Every circle's and space's menu has a Files line for its members. Meeting minutes are also saved there. Used instead of Google Drive once its settings are filled in | `api/controllers/AgoraKdriveController.js`, `lib/agora/kdrive.js`, `lib/agora/kdriveCircles.js`, `lib/agora/kdriveMinutes.js`, `lib/agora/googleLinks.js`, `apps/web/src/agora/files/FilesMenuLink.jsx` |
| Each circle's Google Drive | A Files page per circle lists its Drive folder live: names, who changed a file and when. Files open in Drive. Members of the circle can add files and folders, which go straight into Drive | `apps/backend/agora/files.html`, `api/controllers/AgoraFilesController.js`, `lib/agora/drive.js` |
| Contacts | One shared list of the people and organisations 7BP works with, team members as well as people outside Agora, with notes, follow-ups and a log of every change | `apps/web/src/agora/contacts/`, `apps/backend/api/controllers/AgoraContactsController.js`, `apps/backend/lib/agora/contacts.js` |
| Sign-up by invitation | A new account needs an invitation to a circle: the link in an invitation email, or a circle's join link. People who already have an account log in as before | `apps/backend/lib/agora/signup.js`, `apps/web/src/agora/signup.js` |
| Playbook | A page in each group with every chapter of its playbook: owner, status, last change, a short text and a link. Stewards change it, members read it | `apps/web/src/agora/playbook/`, `apps/backend/lib/agora/playbook.js`, `apps/backend/api/graphql/agora/` |
| Guide and welcome steps | A guide at `/guide` that explains in short parts what Agora can do, and four small welcome steps for a new member at the top of the page | `apps/web/src/agora/guide/` |
| Terms of use and Privacy notice | Agora's own pages at `/terms` and `/privacy`, readable without logging in. The login, sign-up and help links point there instead of hylo.com. Both are drafts until 7BP approves them | `apps/web/src/agora/legal/`, texts in `apps/web/public/locales/en.json` |
| Help and the Help desk | A Help button at the bottom right of every page, where people report faults, wishes and questions. The Help desk is where the team works through them, answers, and turns them into builder tasks | `apps/web/src/agora/help/`, `apps/backend/lib/agora/help.js`, `apps/backend/api/controllers/AgoraHelpController.js` |
| Admin area | A page at `/admin` for the people who run Agora: the main numbers, the Help desk, every invitation and what became of it, all accounts with "Let someone in" and switching accounts off and on, the system and its backups, and the latest events | `apps/web/src/agora/admin/`, `apps/backend/lib/agora/adminDashboard.js`, `apps/backend/api/controllers/AgoraAdminController.js` |
| A free chat list | Hylo's chat used a paid list component (`@virtuoso.dev/message-list`) that shows nothing without a licence key. Agora has its own small list: newest at the bottom, it opens at the last message read, older messages load when scrolling up without the page jumping, and it follows new messages while you are at the bottom | `apps/web/src/agora/chat/AgoraMessageList.jsx` |
| Demo data | A made-up 7BP with circles, people, playbook proposals, playbook chapters and meetings | `apps/backend/scripts/agora-demo.js` |
| Setup scripts | One command to set everything up on a Mac | `agora/` |

Everything Agora changed in Hylo's own files is listed in [AGORA-CHANGES.md](AGORA-CHANGES.md).

## Run Agora on your Mac

You need Apple's command line tools (`xcode-select --install`) and about 10 GB of free disk space. Then, in the Terminal, from this folder:

```bash
./agora/setup-mac.sh
```

This installs the tools, creates the database, writes the settings files and adds demo data. It takes ten to twenty minutes the first time. It is safe to run again.

The database comes from [Postgres.app](https://postgresapp.com), which the script puts in your Applications folder. Node is downloaded from nodejs.org and Redis is built from its own source code, both into `~/.local/share`. None of this needs an administrator password, and nothing big has to be built.

Start Agora with:

```bash
./agora/start.sh
```

After about half a minute, open http://localhost:3000 and log in as `steward@agora.test`. The password is in the file `apps/backend/.agora-demo-login`. The other made-up people (amara, lars, sofia, kenji, priya, all `@agora.test`) use the same password.

This uses a ready-built copy of the web app, so pages open in about a second. The copy is built the first time, and again after the web app's code or settings change. That takes about four minutes on a 2017 MacBook.

To change Agora's code, start it with `./agora/start.sh dev` instead. Then changes show up as you save, but every start is slow and the first page can take a minute to appear.

Press Ctrl-C in the Terminal to stop Agora.

> The setup script has been run on an Intel Mac with macOS 13. If a step fails, the message on screen says which one, and the step can be done by hand.

## Run Agora in the cloud

Claude can work on Agora in Anthropic's cloud while Guy's laptop is off. A cloud session starts from a fresh copy of this repo on a Linux machine and runs:

```bash
./agora/setup-cloud.sh
```

It installs PostgreSQL 17 with PostGIS, Redis and Node 24, creates the databases `agora` (demo data) and `agora_test` (for tests), and writes settings with fresh made-up secrets. The rules for such a session are in `AGORA-CLOUD.md`: draft pull requests on `Guyvk/agora` only, demo data only, no keys.

## Meetings

Open any event and choose **Video meeting in Agora (with minutes)**. The meeting room asks whether your voice may be part of the notes, then opens the call.

Video calls in Agora always go through the event's own meeting room. There is no field for a video call link on an event: Agora gives every event its meeting room as its link, and that link also appears in invitations, emails and calendar entries, so everyone lands in the same room. A link to another platform (Zoom, Google Meet, Teams, Webex, Whereby and the like) cannot be added. The event form has no field for it, the server replaces whatever an app or the API sends, and such a link is refused as an event's location. When `AGORA_MEET_DOMAIN` is empty there is no call server, so events have no video call link at all.

**Older events.** Events made before this can still have a Zoom link, or no link. One command, in `apps/backend` (on the server: `/srv/agora/apps/backend`, as the `agora` user), shows what it would change and saves nothing:

```
node scripts/agora-meeting-links.js
```

Then the same with `--apply` makes the changes: every event gets its meeting room as its link, and an event whose location is only a video call link gets an empty location. A location with more in it (an address and a Zoom link) is listed, for a steward to change by hand. Nobody gets an email; calendars show the meeting room once the worker has made the calendar files again. Running it a second time changes nothing.

How it works:

1. The call itself runs on a Jitsi server, shown inside the room. The server is set with `AGORA_MEET_DOMAIN`. The default is kMeet by Infomaniak.
2. While you are unmuted, your browser records short pieces of your own speech and skips silence. Because each person records only their own microphone, Agora always knows who said what.
3. Each piece is sent to a speech-to-text service and becomes a line in the notes. The sound is deleted as soon as it has become text. The notes are not shown during the meeting: a small line says "Notes are being taken for the minutes. They are not shown during the meeting." Each person sees their own status ("Notes on", "Your notes are paused", "You are muted") and a button to pause their own notes.
4. Next to the call there is a chat for everyone in the meeting, guests included (shown as "Name (guest)"). Messages are plain text, at most 1000 characters. On phones and narrow screens (up to 820 pixels wide) the chat is not shown for now: the call gets the space, and the page does not fetch the chat there. kMeet's own chat, recording, streaming and subtitles buttons are hidden, so everything goes through Agora.
5. "Leave the call" only takes you out. "End meeting for everyone" ends it for all. After the call Agora shows its own end screen: title, date, length, who took part, whether notes were taken, how many chat messages, and a link to the minutes once they are posted. A meeting that ended by itself says why (nobody was in the room, or it ran for 8 hours). kMeet's own close page and feedback form are switched off.
6. A meeting also ends by itself when nobody has been in the room for 10 minutes. While someone is still in it, it goes on, also past the event's end time. Only as a safety cap does a meeting end by itself 8 hours after it started, even with people in it. The check runs every 10 minutes. To list or end meetings that were left open by hand: `node scripts/agora-end-open-meetings.js` (lists only), then `--apply` (ends every open meeting nobody is in; meetings with someone still in them are skipped and listed), `--apply --force` (ends them all, also with people in them) or `--apply --session <number>` (ends one).
7. When the meeting ends, Claude reads the transcript and the chat and writes the minutes. The transcript and the chat go to Claude in separate fenced blocks, marked as raw material and not instructions; anything in them that looks like a fence is taken out, and Claude is told to never follow instructions found there and to record a decision or action only when members clearly agreed to it in the transcript (never from the chat alone, never from guests alone). The minutes are a summary, decisions, actions and open questions. The assistant posts them as a post in the circle the event belongs to: the summary, decisions, actions, open questions and who was there. The full transcript and the chat are not posted. Only if no summary could be written (for example when the Claude key does not work) does the post hold the transcript and the chat instead, so nothing is lost. Only members of that circle can read the post. A meeting with only chat also gets minutes.

Three settings in `apps/backend/.env` switch this on:

| Setting | What to put there |
| --- | --- |
| `AGORA_TRANSCRIPTION_URL` and `AGORA_TRANSCRIPTION_KEY` | The address and key of a speech-to-text service. Any service that follows the OpenAI format works, for example Infomaniak AI Tools (Whisper, hosted in Switzerland) |
| `ANTHROPIC_API_KEY` | A key from a Claude developer account, for writing the minutes |
| `AGORA_MEET_DOMAIN` | The Jitsi server for the call: `kmeet.infomaniak.com` (kMeet by Infomaniak). Every call runs here. If the call cannot be shown inside the room, the room offers the same kMeet room in a second window. Leave empty only to have no video calls at all: then events have no video call link, and the room only writes notes for people sitting together |

Without the first, meetings work but no notes are written. Without the second, you get the transcript without a summary.

Things to know:

- **Use headphones.** Without them, your microphone can pick up other people's voices from your speakers, and their words may appear under your name.
- **Phones.** The room is laid out for phones, but recording next to a call has not been tested on phone browsers yet. On phones the chat is not shown for now.
- **kMeet.** Showing kMeet inside another page works today, but Infomaniak does not document it as a supported use. If it stops working, set another Jitsi server.
- **Consent.** People choose on entering whether their voice is in the notes, and can pause at any time. Agree as a group that meetings are transcribed before using this for real.

## Guests in a meeting

Members can invite people who have no Agora account into a meeting, so the call still happens in Agora.

**Making a link.** Open the event. Every active member of the event's circle sees a box "Guests from outside Agora" under the event. When there is no link yet, any of them can press **Make a guest link**. When there is one, they all see it with a **Copy** button. Send it to the guests by email or chat. People outside the circle see nothing.

**Who can revoke or replace it.** Only the person who made the event, the person who made the link and the stewards of the circle (anyone with Administration or Manage Content there) see **Revoke** and **Make a new guest link**. After a link was revoked, only they can make a new one.

- Agora keeps only a fingerprint (a sha256 hash) of the link, never the link itself. The link's secret is worked out from a random salt that every link gets (new each time a link is made or replaced), the link's own details, and a key that only the server has. So Agora can show the link again to members, while someone who only has the database cannot rebuild it.
- The key is `AGORA_GUEST_LINK_KEY` in `apps/backend/.env`. New servers get a random one from `agora/vps/server-env.mjs`. When it is empty, Agora uses a separate key worked out from `COOKIE_SECRET` (never the cookie secret itself). On the server that is already running, you can set it once: put 64 random hex characters there (for example from `openssl rand -hex 32`) and restart Agora. Setting or changing the key does not break a link, but Agora can then no longer show links made before; make a new one if needed. Links made before this change (they have no salt) keep working but cannot be shown again either. Making a new link stops the old one at once, and guests who came in through it are sent out within seconds.
- The link works until two hours after the event ends (an event without an end time counts as one hour long). Change the event's time before making the link, or make a new link after changing it.
- **Revoke** closes the link. Guests in the call are sent out within seconds.
- There is one link per event. It only works while members are in the meeting: a guest who comes early waits, and the page tries again by itself.
- Guest links need the call inside Agora (`AGORA_MEET_DOMAIN`). Without it the box says so.

**What the guest sees.** The link opens a page that asks for their name (at most 60 letters, digits and spaces) and explains, in plain words, that the meeting is held in Agora by 7 Billion Presidents, that if they agree their speech is turned into text by Infomaniak (Switzerland), that the minutes are written by Claude (Anthropic, United States) and posted inside the circle with their name followed by "(guest)". They choose **Join, and agree to be in the notes** or **Join without being in the notes**. Without the notes their microphone is never recorded by Agora. Then they get the same kMeet call as members, with "(guest)" after their name. They see the call, the chat next to it (not on phones for now) and a Leave button. After the call they get the same end screen as members, without links into Agora. They never see the notes, the transcript, the minutes, the event page or anything else in Agora.

**What members see.** Guests appear in the "Here:" line and in the notes as "Name (guest)". The minutes post lists them on a separate line, "Guests (joined through the guest link, not members of Agora)".

**Safety checks** (in `lib/agora/meetingGuests.js` and `api/controllers/MeetingGuestController.js`, tested in `test/unit/agora/meetingGuests.test.js`):

- The link's secret is 32 bytes: an HMAC-SHA256 of the link's random salt (32 bytes), the event, the person who made the link and the moment it was made, with the server's key (32 random bytes if the server has no key). It is checked against the stored hash in constant time. Wrong, old, revoked and expired links are refused.
- Each guest who joins gets a second secret of their own, so one guest cannot speak under another guest's name.
- Guests can only do seven things: open the page, join, send their own speech (only if they agreed), ask whether the meeting is still going (with the new chat messages), write in the chat, see the end screen, and leave. Leaving never ends the meeting for others. The member calls (notes, ending the meeting, making links) still need a login.
- Calls are counted per internet address: 30 page views, 10 joins, 10 leaves a minute (and 60 joins a minute for all guests of one link together), and per guest 60 pieces of speech, 40 status checks, 30 chat calls and 20 end screen (summary) calls a minute. On top of that, everyone (member or guest) can send at most 20 chat messages a minute and 500 per meeting. An address that tries 20 wrong links in 10 minutes is refused for a while. At most 50 guests per meeting. The counts live in the server's memory, so a restart resets them.
- The guest page tells the browser never to send its address on to other sites (`Referrer-Policy: no-referrer`) and never to keep it.
- The link sits in the page's address, so it can show up in the web server's access log on the server. Treat those logs as private.

## Files in kDrive

7BP keeps its files in kDrive, Infomaniak's file storage in Switzerland (1000 GB). Once Agora has a key to it, every circle has its own folder there, and its Files page in Agora shows that folder. This replaces Google Drive (below): as soon as the three kDrive settings (token, drive number and top folder) are filled in, the Files pages use kDrive. The Google Drive code stays, for if it is ever wanted.

**Where the page is.** Each circle's Files page is inside the app, at `/groups/<circle>/files` (for example `/groups/governance/files`), and a space's at `/groups/<circle>/spaces/<space>/files`, so the circle menu and the top bar stay around it. The old address `/noo/agora/files/<circle>` now sends people there. Every circle's menu, and every space's menu, has a **Files** line that opens it in the same page. It shows for members of that circle or space only (people who are not members do not see the line; the page and its calls check membership on the server again). Nothing needs to be set up for it: no steward has to add the link.

**What members can do there:**

- See the folders and files of their circle: name, size, date, and who added it (when it was added through Agora).
- Open folders, and go back through the line of folders at the top.
- **Download** a file. It comes through Agora: the browser never gets a kDrive link or key.
- **Add files**: pick one or more, or drop them on the list. Up to 100 MB a file (`AGORA_KDRIVE_MAX_UPLOAD_MB`). Empty files are refused. A file with a name that is already there gets a new name (`plan (1).pdf`), so nothing is overwritten.
- **New folder**: makes a folder in the folder that is open.
- **Add a Google Doc**: opens a small form. The member pastes the address of a Google Doc, Sheet, Slides, Form, or a file or folder in Google Drive, and may give a title (without one the list says "Google Doc", "Google Sheet", "Google Slides", "Google Form" or "Google Drive file/folder"). Agora keeps only the address and the title, in its own database (the table `agora_kdrive_links`); nothing goes into kDrive, and Agora never calls Google about it. The link is listed in the folder that is open, among the files, with a coloured Docs, Sheets, Slides, Forms or Drive label, the title, who added it and when. Clicking it opens the original in a new tab. Rename (changes the title only) and Delete follow the same rule as for files: the member who added it, and the circle's stewards; Delete removes the link from the list but never touches the Google document. Agora only accepts `https` addresses at exactly `docs.google.com` or `drive.google.com` (no other website, no `http`, no user name in the address, no other port) for a document, spreadsheet, presentation, form or Drive file or folder, up to 2000 characters, and takes tracking parts (`utm_...`, `usp=sharing` and the like) out of the address. A circle can hold up to 1000 links. The links are only in the kDrive version of the Files page; the Google Drive version of the page does not have them.
- **Comments and suggestions stay in Google Docs.** The form and the page say so. Tell members to check the document's sharing setting in Google: **Commenter** is usually the right one, so people can comment and suggest but not change the text directly. Agora does not see or change that setting.
- **Move**: drag a file, link or folder onto a folder in the list, or onto a part of the line of folders at the top; or choose **Move to…** on a row, which opens a small folder picker. Same rule as Rename: the member who added it, and the stewards. Nothing is moved into the `Minutes` folder, a folder never goes into itself or a folder inside itself, and an item is never put where something has the same name (Agora says so). Moving a file or folder uses kDrive's own move call; moving a link only changes the folder it is listed in. Who added it stays.
- **Select several**: a tick box on every row, and one to select all. With a selection the page offers **Move to…**, **Download** (the files one by one) and **Delete** (one question for all), but only what the person may do with every selected item.
- **Sort**: the columns Name, Added by, Date and Size can be clicked to sort. Folders always stay on top; files and links are mixed.
- **Rename** and **Delete**: only for the member who added that file or folder in Agora, and for the circle's stewards (Administration or Manage Content). Deleting moves it to kDrive's bin, where a kDrive administrator can put it back for a while. The circle's `Minutes` folder is only for the minutes: nobody can rename or delete it from Agora or add anything to it, and nothing else at the top of the circle's folder (file or folder) can be called Minutes. If a file called Minutes was put there in kDrive itself, Agora keeps the minutes in `Minutes (Agora)` instead.

**Who sees what.** Only active members of the circle see its files. The server checks this for every list, download, upload and change, not only the page. Agora never shows or touches anything outside the circle's folder: every file or folder is checked to be inside it. A space (a smaller group inside a circle) gets its own folder inside the circle's folder; members of the circle do not see it from the circle's page, only members of the space do, from the space's own Files page. These are files of 7BP people, so treat them as personal data: travel receipts with bank numbers, for example, do not belong here until 7BP has agreed how it handles such data.

**Meeting minutes.** When the assistant posts a meeting's minutes, Agora also saves them as a text file (Markdown) in the circle's folder, in a folder called `Minutes`, named `2026-10-21 <meeting title>.md`, with the same content as the post: the summary and who was there, or, when no summary could be written, the transcript and the chat. If kDrive does not answer, the minutes post still appears; Agora writes the problem to its log and tries the copy once more 15 minutes later.

**How the folders are made.** Agora makes a circle's folder the first time a member opens its Files page (or the first time its minutes are saved), called `<circle name> (<circle address>)`, for example `Governance (governance)`, and remembers its number. Renaming the circle or the folder later changes nothing. All circle folders go into one top folder, the one in `AGORA_KDRIVE_ROOT_FOLDER_ID`. That setting is required: without it Agora does not use kDrive, and it never makes a top folder itself. You make the folder and decide who in 7BP's kDrive itself can open it: everyone who can open it in kDrive (outside Agora) sees all circles' files.

**Big files.** Agora passes files on to kDrive as they arrive and never keeps a copy. Files above 64 MB go to kDrive in pieces of 16 MB, so Agora's server never holds more than one piece in its memory. On a slow connection a very big upload can take long; keep the page open until it says "Added".

### Setting it up

Once, by Guy (or another kDrive administrator of 7BP):

1. **Make the key (the API token).** Log in at [manager.infomaniak.com](https://manager.infomaniak.com) with the account that manages 7BP's kDrive. Click your name or picture at the top right, choose **My profile**, then **Developer** (some screens call it **API tokens** or **Token management**). Choose **Create a token**. Give it the name `Agora`, choose the scope (Infomaniak calls it a "scope" or "rights") **drive** only, and the longest validity offered. Click **Create**. Infomaniak shows the token **once**: copy it straight away and put it in the password manager. Never paste it into a chat, an email or GitHub.
2. **Find the drive number.** Open kDrive in your browser. Its address looks like `https://ksuite.infomaniak.com/kdrive/app/drive/123456/files` (or `kdrive.infomaniak.com/app/drive/123456/...`): the number after `/drive/` is the drive number.
3. **The top folder (required).** In kDrive, make a folder for Agora, for example `Agora`, and share it in kDrive only with the people who should also see all circles' files outside Agora. Open it: the number at the end of the address (`.../files/7`) is its number.
4. **Tell Agora.** On the server, in `/srv/agora/apps/backend/.env` (on a Mac: `apps/backend/.env`), type in yourself:

   | Setting | What to put there |
   | --- | --- |
   | `AGORA_KDRIVE_TOKEN` | The token from step 1. Secret |
   | `AGORA_KDRIVE_DRIVE_ID` | The drive number from step 2 |
   | `AGORA_KDRIVE_ROOT_FOLDER_ID` | The folder number from step 3. Required |
   | `AGORA_KDRIVE_MAX_UPLOAD_MB` | The largest file a member may add, in MB. Empty means 100 |

5. **Update the database and restart.** On the server, `agora/vps/update.sh` does both: it runs `yarn migrate` (which adds the two tables that remember the circle folders and who added what) and restarts Agora. On a Mac: `yarn migrate` in `apps/backend`, then restart with `./agora/start.sh`.
6. **Check.** Open a circle's Files page as a member. The first time it makes the circle's folder; you see it appear in kDrive. The admin area (`/admin`, System) shows "kDrive (circle files): Yes", or "No: AGORA_KDRIVE_ROOT_FOLDER_ID is missing" when only the top folder is missing.

The token works for everything the account that made it can reach in kDrive. Agora only uses it inside its own top folder, but whoever has the token could do more, so keep it as secret as a password. If it leaks, delete it in the same Developer page and make a new one.

The key is never shown: not in Agora's pages, not in the admin area, not in error messages and not in the log. Agora sends it only to Infomaniak's own addresses.

**Limits.** kDrive limits how many calls a key may make (about 60 a minute, according to others who use it). Agora makes at most 50 a minute from the website and 50 from the worker, and waits and tries again when kDrive says it is busy. With many people on the Files pages at once, a page can then say "kDrive is busy. Try again in a minute."

## Google Drive

Each circle has a Files page at `/noo/agora/files/<circle>`, where `<circle>` is the last part of the circle's address in Agora (for example `7bp-governance` in `/groups/7bp-governance`). It lists the circle's Drive folder: names, who changed a file last and when. Clicking a file opens it in Google Drive, so Drive keeps deciding who may read or edit it. Only members of the circle see its files. They see the names of all files in its folder, including files Drive may not let them open.

How Agora knows the folder: there is one main 7BP folder in Drive (a shared drive), and inside it a folder for each circle. An administrator links each circle to its folder once, with a command in the Terminal (see "Link the circles" below). Agora never guesses the folder from the circle's name, because anyone can make a circle and call it anything. Renaming a circle or a folder changes nothing. A circle without a link says "No Google Drive folder is linked yet". Agora never shows or adds anything outside a circle's linked folder, and a linked folder must be inside the main folder.

### Adding files from Agora

When adding is switched on (`AGORA_DRIVE_UPLOADS=on`), members of a circle see three buttons on its Files page:

- **Add files**: pick one or more files. They go into the folder that is open and show up in the list when they are done. Files can also be dropped on the list.
- **New folder**: makes a folder in the folder that is open.
- **My folder**: opens the folder with your own name in the folder that is open, and makes it the first time. This is how 7BP works in Drive today: each person puts photos and videos in a folder under their own name.

Only members of that circle see and add to its folder. Agora never changes, moves or deletes what is already in Drive.

Big videos are fine, up to 5 GB a file (`AGORA_DRIVE_MAX_UPLOAD_MB`). They do not pass through Agora: Agora checks that you are a member, asks Google for a one-time upload address for that one file in that one folder, and your browser sends the file straight to Google in pieces of 8 MB, with a percentage on screen. If the connection breaks, a piece is tried again. Keep the page open until it says "Added"; the browser asks before you leave halfway. If a browser cannot send to Google directly, files up to 25 MB go through Agora's server instead, and bigger ones have to be put in Drive by hand. Whether browsers can send to Google directly has been tested with a pretend Google only, so try it with one real big video first.

In a shared drive, an added file belongs to 7BP; Drive shows Agora's robot account as the one who added it. The Files page shows the name of the member who added it.

**Travel receipts and tickets.** These often carry bank account numbers (IBANs), amounts and travel details: financial personal data. Keep them out of Agora's Files pages until 7BP has agreed how it handles personal data (see "Contacts"), or keep them in a folder that is not linked to any circle and not inside a linked folder, so Agora never shows them.

### Setting it up: a shared drive and a robot account

7BP has Google Workspace, so files live in a shared drive that belongs to 7BP as an organisation, and Agora reaches it through a robot Google account, which Google calls a service account. A robot account has no storage of its own, so it can only add files to a shared drive, not to someone's "My Drive". Once:

1. **The shared drive.** In Google Drive, signed in with a 7BP Workspace account, choose *Shared drives*, *New*, and call it `7BP Agora`. Inside it, make a folder per circle. The names are free: the link in step 6 decides which folder belongs to which circle. This shared drive is the main folder.
2. **The robot account.** Go to [console.cloud.google.com](https://console.cloud.google.com), signed in with the 7BP account. Make a project called Agora. Under *APIs and services*, switch on the *Google Drive API*. Under *IAM and admin*, then *Service accounts*, create an account called `agora-drive`, with no roles. Open it, choose *Keys*, *Add key*, *JSON*. Your browser downloads a key file. Keep it secret: anyone with it can read and add to the shared drive. For organisations made after May 2024, Google blocks making keys: a Workspace admin allows it for this one project (the policy is called *Disable service account key creation*).
3. **Share.** Open the shared drive, choose *Manage members*, and add the robot account's email address (it ends in `iam.gserviceaccount.com`) as **Contributor**. Contributor can add files but cannot delete or move anything. For reading only, *Viewer* is enough. If sharing with people outside the organisation is switched off in Workspace, a Workspace admin allows it for this shared drive.
4. **Tell Agora.** In `apps/backend/.env`, set `AGORA_DRIVE_FOLDER_ID` to the shared drive's link (open it in Drive and copy the address), `AGORA_GOOGLE_SERVICE_ACCOUNT_KEY` to the key file in base64, and `AGORA_DRIVE_UPLOADS=on`. In the Terminal, `base64 -i ~/Downloads/<the key file>.json | pbcopy` copies the key, ready to paste. Then put the key file in the password manager and delete it from Downloads.
5. **Restart Agora.** The first time after this change, also run `yarn migrate` in `apps/backend`: it adds the table that keeps the links.
6. **Link the circles.** See below.

### Link the circles

In the Terminal, in `apps/backend`:

- `node scripts/agora-drive-link.js` lists which circles are linked, and every folder in the main folder with its id.
- `node scripts/agora-drive-link.js <circle> <folder link or id>` links a circle. `<circle>` is the last part of its address, for example `governance`. The script refuses a folder that is not inside the main folder.
- `node scripts/agora-drive-link.js <circle> --remove` removes a link.

Only someone with access to the server can do this; nothing in the website can change a link. Then, in each circle's settings, a steward adds a link to its Files page to the circle's menu.

### Fallback: a Google account instead of a robot account

Only if the robot account cannot be used, for example because the Workspace admin will not allow keys. Agora then logs in as a normal Google account. Agora gets the whole Google Drive of the account it logs in as, so use a Google account made only for Agora (for example `agora-drive@` in 7BP's Workspace), that is a Contributor or Editor on the `7BP Agora` shared drive and nothing else. **Never your own personal account, and never a Workspace admin account.**

1. **The account.** Make that account. Put its password in the password manager, and give two other key holders access, like every outside account. Add it to the shared drive as *Contributor*.
2. **The project.** In [console.cloud.google.com](https://console.cloud.google.com), in the Agora project, the *Google Drive API* must be on.
3. **The login screen.** Under *APIs and services*, then *OAuth consent screen* (newer screens call it *Google Auth Platform*): choose *Internal* if it is offered (only accounts of 7BP's Workspace can then log in), otherwise *External*, then **Publish app**. While an External app is in "Testing", Google ends Agora's login after seven days.
4. **The login client.** Under *Clients* (or *Credentials*, *Create credentials*, *OAuth client ID*), make a client of the type **Desktop app**, called `Agora`. Put its client ID and client secret in `apps/backend/.env` yourself, as `AGORA_GOOGLE_OAUTH_CLIENT_ID` and `AGORA_GOOGLE_OAUTH_CLIENT_SECRET`. Leave `AGORA_GOOGLE_SERVICE_ACCOUNT_KEY` empty.
5. **Let Agora in.** In the Agora folder, run `node agora/google-drive-login.mjs`. Your browser opens Google's login page. Log in as the account made for Agora. If Google warns that it has not verified the app: *Advanced*, then *Go to Agora*. The script writes `AGORA_GOOGLE_OAUTH_REFRESH_TOKEN` into `apps/backend/.env` without showing it, makes the file readable by you only, and says which account it used.
6. Restart Agora and link the circles as above.

If Agora ever says Google refused its login, for example after the account's password was changed, run step 5 again.

## Contacts

The Contacts button in the bar on the left opens the Contacts page (`/contacts`), part of Agora like Messages: one shared list of the people and organisations 7BP works with: team members (their profiles from the activist week are to be added later), and people outside Agora such as partners, press, funders and people who are interested. The number on the button is how many of your follow-ups are due.

- For each contact: name, organisation, kind, email, phone, website, status, the circle that mainly deals with them, where their details came from, and whether they agreed to be contacted.
- Notes keep what was said or done, with who wrote them and when.
- A follow-up is a next step with a date and a person. "My follow-ups" lists yours.
- Every Agora member, meaning everyone in at least one circle, can read, add, change and delete contacts. Every change is logged with who made it and which fields changed, never what they said. Deleting a contact removes the person and their notes for good.

These are people who never signed up to Agora, so their details are personal data under the GDPR. 7BP needs a reason to keep them, has to delete anyone who asks, and has to answer when someone asks what is kept about them. Before real contacts go in, an experienced developer looks at this part, and 7BP agrees who answers such questions. Until then, only the made-up demo contacts are in it.

## Who can sign up

Agora is by invitation. Only someone who holds an invitation to a circle can make an account:

- the link in an invitation email that a steward of a circle sent. It only makes an account for the email address it was sent to, so a forwarded link does not let anyone else in. It stops working once the person has joined the circle with it, or when the steward withdraws it. Or:
- a circle's join link. Anyone who has it can make an account, with any email address, as many times as they like, until a steward makes a new link or the circle is deleted. Share it only with people you would invite anyway.

**Opening an invitation email.** The link in an invitation email belongs to the address it was sent to:

- Not logged in: the sign-up page fills in that address and does not let it be changed. The person clicks "Create account" and goes on with the code, as always.
- Logged in with that address: the invitation is accepted, as in Hylo.
- Logged in with another account (for example the steward who sent it, trying it out): the invitation is not used. A page says "This invitation is for guyvankool@gmail.com. You are logged in as Guy van Koolwijk (info@guyvankoolwijk.nl). Log out to accept it as guyvankool@gmail.com." The button "Log out and continue" logs out and opens the invitation link again. The server refuses such a use too, so it cannot be skipped. A circle's join link has no address and works for everyone.

Someone who opens the sign-up page without one reads "Agora is by invitation" and is asked to get an invitation from a 7BP steward. The server checks this too, so it cannot be skipped by going around the web page. A first login with Google, Facebook or LinkedIn is always refused while sign-up is by invitation (Agora does not show those buttons). People who already have an account are not affected and log in as before.

The setting is `AGORA_INVITE_ONLY` in `apps/backend/.env`: `on` or `off`. Left empty, it is on for a server and off on your own computer, so demo sign-ups keep working there. `off` brings back Hylo's way: anyone who finds the address can sign up.

**Making a circle.** Anyone with an account can still make a new circle, as in Hylo. Whether only stewards should be able to is an open question.

**Letting one person in without a circle.** On the server, in `/srv/agora/apps/backend`:

```
sudo -u agora -H env PATH=/opt/agora-node24/bin:/usr/bin:/bin node scripts/agora-allow-signup.js someone@example.org
```

It prints a sign-up link that works for 4 hours (and also emails it, once a mailbox is connected). Opening the link confirms the address and goes on to choosing a name and password. Keep the link private: it logs in as that address. This is how the first person gets in, see "After the setup" below. Once you are an Agora admin, **Let someone in** in the admin area does the same from the page (see "Admin area").

**When a steward cannot invite.** If a steward is told "You don't have permission to create an invitation", the database lacks the list of what stewards may do. A new database made from Hylo's `schema.sql` has the tables but not that list. The setup and update scripts add it, and also repair circles that were made without it. To do it by hand, in `/srv/agora/apps/backend`:

```
sudo -u agora -H env PATH=/opt/agora-node24/bin:/usr/bin:/bin node scripts/agora-steward-roles.js
```

It only adds what is missing, so it is safe to run again.

## Playbook

Each group has a playbook page at `/groups/<group>/playbook`, for example `/groups/7bp/playbook`. It lists the chapters of the group's playbook (such as onboarding, governance, communications, fundraising, events and tech) in their order. For each chapter it shows the owner (a member of the group), the status (not started, draft, in review or agreed), when it was last changed and by whom, a short text, and a link, for example to a Google Doc or a post.

- Members of the group read it. People outside the group see nothing.
- Stewards of the group (people with the Administration responsibility) read it too, and add, change and remove chapters on the same page. The server checks this for every change. For a space, the stewards of its parent group count as its stewards, as everywhere in Hylo.
- The Playbook line in the group's menu shows when the group has chapters, or for a steward who can add the first one.
- The order is a number per chapter: lowest first. A new chapter goes last unless you give it a number.

## Guide and welcome steps

The guide is a page in Agora at `/guide`. It explains in short parts what Agora is for 7BP: circles and joining by invitation, posts, discussions and proposals, events and the meeting room with its notes, files in Google Drive, the playbook, contacts, notifications and email digests, your profile, where to get help (the Help button at the bottom right and the Help desk), and the Terms of use and Privacy notice. Parts that are not live yet (a guest link for meetings, Google Drive, Agora's own mailbox) say "Coming soon". Change the guide when something new goes live: its parts, in order, are in `apps/web/src/agora/guide/guideParts.json`, and their words in the language files. The same parts show in the Help window, and Claude in Help answers from them, so one change reaches all three.

People find it:

- in the question mark menu in the bar on the left (it replaces the link to Hylo's own user guide), and in the tab bar's help menu;
- in the gear menu in the same bar, under Agora guide;
- on the last page of the sign-up wizard, as the first card;
- in the welcome steps;
- in the Help window, under Guide, which is what Help opens on.

The welcome steps are a small box at the top of the page for a new member, with four steps: fill in your profile, open your circle, read the guide, say hi in your circle. Each step is ticked off by itself: the profile when it has a line about you or a bio, the circle once any circle has been opened, the guide once it has been opened, saying hi once its link to the circle's chat has been used. The box goes away when all four are done, or when the person closes it with the cross. Agora remembers that with the account, in Hylo's own list of guided tours someone has seen (the `toursSeen` setting), so it does not come back on another device and needs no change to the server. The box is not shown on maps, in messages, in settings or during the sign-up wizard.

The guide is in English. The headings, the menu item and the welcome steps are also in the other languages; the longer texts follow once the guide has settled.

## Terms of use and Privacy notice

Agora has its own Terms of use at `/terms` and Privacy notice at `/privacy`. Anyone can read them, also without an account. The links on the login and sign-up pages, in the help menu and in the sign-up agreement go there.

Both are **drafts**: a box at the top of each page says "Draft, to be approved by 7BP", and the questions that are still open are listed at the end of each page. Words in [square brackets], such as the foundation's legal name, address and contact email, still have to be filled in. This is not legal advice: someone who knows the GDPR should read both before real members rely on them.

The words are in `apps/web/public/locales/en.json`, under keys that start with `agoraTerms.`, `agoraPrivacy.` and `agoraLegal.`. Other languages show the English text until the English is approved and translated. To add or move a paragraph, change `apps/web/src/agora/legal/legalTexts.js` as well. When Agora starts sending data somewhere new (a mail service, the help chat, a second backup), update the Privacy notice in the same pull request.

## Help and the Help desk

Everyone who is logged in sees a **Help** button at the bottom right of every page. It opens a small window on the **Guide**: a search box and the parts of the guide as a short list. Clicking a part shows its text in the window, with "Open the full guide" to that part on the guide page (`/guide#<part>`). Under the list, **Still stuck? Tell us** leads to the form or the chat. There people tell, in their own words, what is wrong, what they wish for, or what they want to know. Agora adds by itself: the page they were on (without the part after a `?`, which can hold codes), their browser, their screen size, the version of Agora and who they are. Under **My requests** they see what they sent, its status and the answers from the team, and they can add to it. A number on the button shows new answers.

Other pages can open Help on a given view with `openHelp()` from `apps/web/src/agora/help/openHelp.js`: `openHelp({ view: 'guide', part: 'events' })` for one part of the guide, `openHelp({ view: 'new' })` for the form or chat, `openHelp({ view: 'mine' })` for My requests. The **Open Help** button in the guide's Getting help part uses it.

There are two ways to send a request:

- **The plain form** (always there): what it is about (something is wrong, a wish, a question), what happened, what they expected, and how urgent it is.
- **A chat with Claude**, only when `ANTHROPIC_API_KEY` is set. Before the first message a line says that the messages go to Claude (Anthropic) to be answered, with a link to the plain form instead, as 7BP's Governance Proposal asks for consent before member data goes to AI tools. Claude answers how-to questions from the same guide members read: the first time someone chats, the server reads the parts from `apps/web/src/agora/guide/guideParts.json`, in order, with their English words from `apps/web/public/locales/en.json` (see `apps/backend/lib/agora/helpGuideText.js`). After the guide come a few extra notes for Help in `apps/backend/lib/agora/helpGuide.md`, things the guide leaves out, such as where the settings are. Put anything members should read in the guide itself, not in those notes. For a fault or a wish it asks one or two questions at most, then sends a request with a short title, type, urgency and summary, and keeps the whole chat with it. If Claude cannot be reached, says no, or someone sends too many messages, the window switches to the plain form with what they wrote filled in. Chats that did not become a request are deleted after a week.

What people send ends up in the **Help desk**, a tab of the admin area (see "Admin area" below). A request can be read only by the person who sent it and by the people who run the Help desk. The server checks this for every request.

Settings in `apps/backend/.env` (who runs the Help desk: see "Admin area"):

| Setting | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | A key from a Claude developer account. Without it, Help is the plain form |
| `AGORA_HELP_MODEL` | The Claude model for Help. Default `claude-haiku-5-5`, small and fast |
| `AGORA_HELP_CHAT_PER_HOUR` | Chat messages per person per hour, default 30 |
| `AGORA_HELP_REQUESTS_PER_DAY` | New requests per person per day, default 20 |
| `AGORA_HELP_REPLY_EMAIL` | `off` sends no email when the Help desk answers |
| `AGORA_HELP_GUIDE_FILE` | Another file for Claude to answer from, instead of the guide and `helpGuide.md` together |
| `AGORA_VERSION` | The version stored with each request. Without it, the git commit Agora runs from |

After updating to a version with Help, run `cd apps/backend && yarn migrate` once, which adds the three tables (`agora_help_requests`, `agora_help_replies`, `agora_help_chats`), and `yarn install` for Anthropic's library.

## Admin area

The admin area is a page in Agora at `/admin` (for example https://agora.guyvankoolwijk.nl/admin), for the people who run Agora. They find it in the gear menu in the bar on the left, under **Admin**. Everyone else does not see the link, and the page tells them it does not exist. The server checks this for every request.

### Who gets in

Two settings in `apps/backend/.env`, each a list of user ids or email addresses separated by commas, for example `1,guy@example.org`:

| Setting | Who | What they see |
| --- | --- | --- |
| `AGORA_ADMINS` | Agora admins | The whole admin area, all six tabs |
| `AGORA_HELPDESK_ADMINS` | People who only run the Help desk | Only the Help desk tab. Every other part of the admin area refuses them |

For both: the account must be switched on, and an email address only counts when the account has confirmed it, so nobody gets in by signing up with an address from the list. Ids are the surest. To find a user id: open the profile in Agora; the number in the address (`/members/<number>`) is the id. Empty settings mean nobody gets in (Help requests are still kept).

### The six tabs

- **Overview**: how many members (accounts that are switched on), new sign-ups in the last 7 and 30 days, circles, people who were active in the last 7 days (logged in or used Agora), invitations and join requests that wait, and the meetings of this month with the minutes of sound that went to speech to text. The cost next to it is an estimate at 0.006 per minute; the real bill comes from Infomaniak. A Help desk box shows the open requests per status and the newest few, each a link into the Help desk tab.
- **Help desk** (`/admin/help-desk`; the old address `/help-desk` still works and leads there). People who run the Help desk also find a "Help desk" link in their own Help window. There they:
  - see every request, filtered by status (new, looking at it, being built, fixed, won't do) and type, with how many there are of each;
  - open one to read it with the chat, who sent it, the page, browser, screen and version;
  - change the status, and keep an internal note that only the Help desk sees;
  - answer the person. The answer shows in their Help window, and they get an email (through Agora's own email sender, so on a Mac it is printed in the Terminal). A change of status also shows as new in their window, without an email;
  - use **Build this**: it marks the request as being built and stores a short task for a builder, without names or personal details, ready to copy. Type the task yourself, or, for a request that came from a chat with Claude, leave the box empty and Claude writes it; the person's name and email address are taken out before anything goes to Claude. A request from the plain form is never sent to Claude. Agora warns when a task seems to name the person. A field holds a link to wherever the task ends up. Nothing is posted anywhere else yet.

  The internal note and the builder task are for the Help desk only.
- **Invitations**: every circle invitation in one list, with its circle, who sent it, when it was made and last sent, how often it was sent, and what became of it: waiting, accepted (by whom and when) or expired or withdrawn. Filter by status and circle. For a waiting invitation: copy its link, send it again (Hylo's own invitation email) or withdraw it. Below that, each circle's join link (to copy) and the join requests that wait. Hylo does not record who joined through a join link, so the page shows how many members joined without an email invitation (through the join link, a join request, or added by a steward).
- **Accounts**: everyone with an account, with email address, circles, when they joined, when they were last active, whether the email address is confirmed and whether the account is on, switched off or a sign-up that was never finished. Search by name or email. **Switch off** uses Hylo's own deactivate: the person is logged out everywhere and cannot log in, and nothing is deleted. **Switch on again** brings the account back. You cannot switch off your own account here, and nothing on this page deletes anyone.
- **System**: the version (the code version, a git commit) that runs, how long Agora and the server have been running, disk, memory and database size, which outside services are set up (speech to text, Claude, email, kDrive, Google Drive, the video call domain, sign-up by invitation), and the backups: the last nightly backup and whether the copy away from the server is set up and when it last worked. What the page cannot read says "check on the server". It never shows a key, password or token.
- **Activity**: the latest events, newest first, 50 per page: accounts made, invitations sent, accepted and withdrawn, circles made, people joining or leaving circles, join requests, meetings that ended and Help desk requests. It is put together from what Agora already stores, so it needs nothing new.

### Let someone in

On the Accounts tab, **Let someone in** does what `scripts/agora-allow-signup.js` does, from the page. Type an email address, and choose a circle if you like:

- **with a circle**, Agora makes an invitation to that circle, the same as a steward's invitation. Its link lets the person make an account and join the circle. It keeps working until it is used or withdrawn;
- **without a circle**, Agora makes a sign-up link that works for 4 hours, the same one the script prints.

The page shows the link to copy. While Agora has no mailbox, emails only go into the server log, and the page says "Send it yourself: Agora cannot email yet". Keep a sign-up link private: whoever opens it can make the account for that address. Someone who already has an account is told so; they can log in.

The admin area cannot log in as someone else and cannot delete accounts. Hylo's own staff admin (`/noo/admin`) is separate and stays unused.

The time of the last copy away from the server comes from a small mark file that `agora/vps/offsite-backup.sh` leaves in `/var/backups/agora` after each copy that worked, so it shows after the first night with this version.

### After updating to a version with the admin area

**Important:** until now the server only had `AGORA_HELPDESK_ADMINS=1`. That still opens the Help desk tab, but nothing else. To keep Guy in charge of the whole admin area:

1. Open the settings file: `sudo -u agora nano /srv/agora/apps/backend/.env`
2. Add the line `AGORA_ADMINS=1` (1 is Guy's user id; add more ids with commas). The line `AGORA_HELPDESK_ADMINS=1` may stay. Save with Ctrl+O and Enter, and close with Ctrl+X.
3. Restart: `sudo systemctl restart agora-api agora-worker`
4. Open `/admin` in Agora. If only the Help desk tab shows, `AGORA_ADMINS` is missing or has the wrong id.

No database change is needed.

## Email

On your own computer no email is sent. Every email is printed in the Terminal instead, so you can copy sign-up codes and links from there.

To send real email, set `AGORA_EMAIL_TRANSPORT=brevo`, `BREVO_API_KEY` and `EMAIL_SENDER` in `apps/backend/.env`. Sending through Brevo has been written but not yet tried against a real account.

To send through any mail server (for example Infomaniak's), set `AGORA_EMAIL_TRANSPORT=smtp` and the `AGORA_SMTP_...` settings; see `apps/backend/lib/agora/mailer.js`.

Emails that Agora has no text for yet are not sent. A line in the log says so. Notification emails stay off while `EMAIL_NOTIFICATIONS_ENABLED=false`.

**What every email looks like.** Agora writes its emails itself, in `lib/agora/mailer.js`, and checks these things for all of them:

- They say Agora, never Hylo, also in the sender name ("Guy van Koolwijk (via Agora)", or just "Agora").
- Text from Hylo's database that is HTML, like the text of an invitation or a post, is turned into plain paragraphs and then made safe, so no HTML and no `&lt;p&gt;` codes show up.
- Links are short and clean. Hylo adds click counting to its links (`?ctt=post_email&cti=1&ctcn=Governance`); Agora takes that out. The link to change your email settings is simply `https://<Agora's address>/my/notifications`: whoever is not logged in logs in first and lands there. Hylo's own link held a login token of about 600 characters, your name and your user id. Agora sets no `List-Unsubscribe` header (Hylo does not either).
- The links in the email to set a new password and to confirm your address for sign-up still carry a long code. They log you in, so the code has to be in them. Making those short needs a change to how logging in works.

## Uploads

Profile pictures, banners, pictures and files added to posts and comments, and the calendar files people subscribe to, are kept on Agora's own server, in one folder:

- on the server: `/var/lib/agora/uploads`, readable only by the user `agora`, and copied into the nightly backup;
- on a Mac: `apps/backend/.agora-uploads` (git ignores it).

The setting `AGORA_UPLOADS_DIR` in `apps/backend/.env` changes the folder. Agora's own server hands the files out at `https://<Agora's address>/noo/uploads/...`. Clicking an upload button opens your browser's own file picker, and the file goes straight to Agora; nothing passes through Filestack or Amazon. A file can be up to 10 MB (Hylo's limit). Profile pictures are made 200 by 200 pixels, and pictures in posts at most 1200 pixels wide, like in Hylo. Big videos belong in the circle's Google Drive.

Things to know:

- **Anyone with the address of a file can open it**, also without logging in, and also when it was posted in a private circle. This is how Hylo works with Amazon S3 too. The addresses are long and hard to guess, but they are not secret: whoever gets a link can pass it on. Put nothing in an upload that must stay inside a circle; use the circle's Drive folder for that.
- Web pages, SVG drawings and other files that a browser could run are offered as downloads, never shown as part of Agora. Profile pictures and banners must really be pictures: JPEG, PNG, GIF or WebP.
- **iPhone photos (HEIC) and AVIF pictures are not accepted as profile pictures or banners yet.** Convert them first, for example with *Export* in the Photos app or by taking a screenshot. They can still be added to posts as files.
- A shortcut (a "symbolic link") inside the uploads folder is followed, so it could hand out a file from elsewhere on the server. Only someone who can log in to the server can make one; Agora itself never does.
- **A server set up before uploads moved to disk** needs the folder made once, because `update.sh` does not make it. Log in to the server and run:
  ```
  sudo install -d -o agora -g agora -m 750 /var/lib/agora /var/lib/agora/uploads
  sudo apt-get install -y rsync
  sudo sed -i 's|^AGORA_UPLOADS_DIR=.*|AGORA_UPLOADS_DIR=/var/lib/agora/uploads|' /srv/agora/apps/backend/.env
  sudo grep -q '^AGORA_UPLOADS_DIR=' /srv/agora/apps/backend/.env || echo 'AGORA_UPLOADS_DIR=/var/lib/agora/uploads' | sudo -u agora tee -a /srv/agora/apps/backend/.env
  sudo /srv/agora/agora/vps/update.sh --force
  ```
  The update step also runs `yarn install`, which the new building block (`send`) needs.
- If a bucket and key for Amazon S3 are set (`AWS_S3_BUCKET` and `AWS_ACCESS_KEY_ID`), Agora uses S3 like Hylo, and the folder is not used. Setting a Filestack key brings Hylo's Filestack picker back.

## 7BP Home (main circle)

Agora starts as separate circles with no place that holds them all. The 7BP Home is one main circle, by default named "7BP" with the slug `7bp` (set `AGORA_MAIN_GROUP_SLUG` and `AGORA_MAIN_GROUP_NAME` in `apps/backend/.env`). It is visible to its members only, people join by invitation or join link, and the Commons stays off.

**This changes who sees what.** Every member of any circle becomes a member of the 7BP Home and sees its stream (announcements, meetings, events), its members and its circles. Circles themselves keep their own members, settings and posts.

What it does (`apps/backend/lib/agora/mainGroup.js`), and only adds what is missing, so a second run changes nothing:

1. Makes the main circle if it does not exist, in Hylo's own way (roles, menu and chat room like any circle). The maker is the first active account in `AGORA_ADMINS`, who becomes its Administrator. (The other Agora admins get the role through the admins-everywhere job, once that is merged.)
2. Makes every other active circle a child of it. A circle that a steward took out of the main circle on purpose stays out and is listed as "kept apart".
3. Makes every active account with a confirmed email address that is a member of at least one active circle a member of the main circle, with the role Member. Existing memberships stay as they are. Someone who left the main circle (or was removed) is not added again: Hylo records leaving as an inactive membership, and the job respects it. New memberships are quiet: no join form, notifications only for mentions and announcements, a weekly digest, and nobody is told "X joined". A member can change this in the circle's settings.
4. Sets up the home page once: a welcome page as the home ("The home of 7 Billion Presidents: announcements, meetings and all our circles."), the stream with its announcements, events and meetings, members, chat, and a menu entry for each circle. It is remembered in the circle's settings, so a page a steward removes later stays removed, and only circles made later get a menu entry. A welcome page that already has text keeps it.

On the server, from `/srv/agora/apps/backend` as the `agora` user (first look, then save):

```
node scripts/agora-main-group.js
node scripts/agora-main-group.js --apply
```

The first command shows every change and saves nothing. The cron job runs the same with `--apply` every 10 minutes, so people who join any circle later also land in the 7BP Home and new circles become its children. A failure is logged and never stops the other cron tasks.

To undo: a steward can remove a circle from the 7BP Home in that circle's settings (it stays out), remove members, or delete the circle in its settings. If the main circle itself is deleted in its settings, the job does not make it again (it reports that the slug is taken by a switched-off circle). To stop the job altogether, take it out of `cron.js`.

Tests: `DATABASE_URL=postgres://$USER@localhost:5432/agora_test yarn test test/unit/agora/mainGroup.test.js` (they empty that database).

## What is switched off

- **Tracking.** `DISABLE_SEGMENT=1` stops the server from sending usage events to Segment. The Mixpanel and Intercom keys are empty. The cookie banner still mentions them and needs to be changed.
- **Payments.** Not used. The server insists on a `STRIPE_SECRET_KEY`, so the settings file holds a placeholder.
- **Filestack and Amazon S3.** Hylo sends uploads through Filestack and keeps them in Amazon S3. Agora uses neither: see "Uploads" below.
- **The Commons.** Hylo's public area, with public posts, a public group directory and a public map. Agora has nothing public yet, so its button and tab are hidden and its pages go to My Home. One switch in `apps/web/src/agora/config.js` brings it back.
- **Phone apps and push notifications.** Agora is a website.

## Going online

Agora runs on one rented server in Switzerland, with Ubuntu 24.04: an instance in Infomaniak's **Public Cloud** with 2 processors and 4 GB memory (about 9 to 12 euros a month, paid per hour at the end of each month, no commitment; new accounts get CHF 300 of credit for the first 3 months). Guy chose this on 17 October because the cheaper VPS Lite is only sold by the year. Any Ubuntu 24.04 server works the same way, a VPS Lite too. One script sets everything up: the database, the job queue, Agora itself, https, the scheduled jobs (digests, reminders) and a nightly backup. The files are in `agora/vps/`.

**Once, before you start**

1. Make an ssh key on your Mac, if you have none yet: open Terminal and type `ssh-keygen -t ed25519`, then press Enter three times. Your public key is in `~/.ssh/id_ed25519.pub`. That file is safe to share; the other one (without `.pub`) never leaves your Mac.
2. In the Infomaniak Manager, order a **Public Cloud** and wait for the email that it is ready. Then create a **project** in it. You choose the project's password yourself and keep it to yourself.
3. In the project's dashboard:
   - **Key pairs:** import your key under the name `guy-mac`, by pasting the contents of `id_ed25519.pub`.
   - **Security groups:** make a group `agora-web` that lets in TCP ports 22 (ssh), 80 (http) and 443 (https) from anywhere.
   - **Instances, Launch:** name `agora`, image **Ubuntu 24.04**, a size with 2 processors and 4 GB memory (for example `a2-ram4-disk50-perf1`), the public network, key pair `guy-mac`, security group `agora-web`.
4. Note the instance's public IP address. The login user on Infomaniak's Ubuntu images is `ubuntu`.
5. Ask whoever manages the domain to add an **A record**: `agora` pointing at that IP address. Until then you can use a test address, for example `agora.guyvankoolwijk.nl`.

**Setting up the server** (about 30 minutes, most of it waiting)

```
ssh ubuntu@<the IP address>
curl -fsSLO https://raw.githubusercontent.com/Guyvk/agora/agora/agora/vps/setup-server.sh
sudo bash setup-server.sh agora.7billionpresidents.org
```

The user name may be `ubuntu` or `root`; the Manager shows which. At the end it says where to open Agora. The certificate for https is made on the first visit.

**What it does, in order:** updates Ubuntu; turns on the firewall, automatic security updates and fail2ban (it blocks addresses that keep guessing passwords); turns off logging in with a password when a key works; adds 4 GB swap for building; installs Node 24 (checked against its published checksum), PostgreSQL with PostGIS, Redis and Caddy; makes a user `agora` that owns the code in `/srv/agora`; makes the database with its own password (in `/home/agora/.agora-db-password`); writes the settings with fresh secrets (`agora/vps/server-env.mjs`); installs and builds; fills the empty database; and starts everything with systemd. No demo data goes in. `scripts/agora-demo.js` refuses to run when `NODE_ENV=production`.

**After the setup**

- **The first account.** Agora is by invitation, and on an empty server there is no circle yet, so nobody can invite. Let yourself in with one command over ssh, in `/srv/agora/apps/backend`:
  ```
  sudo -u agora -H env PATH=/opt/agora-node24/bin:/usr/bin:/bin node scripts/agora-allow-signup.js you@example.org
  ```
  (First `cd /srv/agora/apps/backend`.) It prints a link. Open it in your browser within 4 hours, choose your name and password, and make the first circle. From then on, invite people from the circle (its settings, *Invite*), or send them its join link.
- **Email:** when the 7BP mailbox exists, add these lines to `/srv/agora/apps/backend/.env` (with `sudo -u agora nano /srv/agora/apps/backend/.env`), then `sudo systemctl restart agora-api agora-worker`:
  ```
  AGORA_EMAIL_TRANSPORT=smtp
  AGORA_SMTP_HOST=smtp.gmail.com
  AGORA_SMTP_PORT=587
  AGORA_SMTP_USER=agora@7billionpresidents.org
  AGORA_SMTP_PASSWORD=<the app password>
  EMAIL_SENDER=agora@7billionpresidents.org
  ```
  You type the password in yourself. Nobody else needs to see it.
- **Updates:** after a change is merged on GitHub, `sudo /srv/agora/agora/vps/update.sh`. It backs up the database first.
- **Is it running?** `sudo systemctl status agora-api agora-worker agora-web`. Logs: `sudo journalctl -u agora-api -f`.

**Still to do**

- The nightly backups (`/var/backups/agora`, 14 days, the database and the uploads) sit on the same server. A second, encrypted copy in Infomaniak's object storage is ready but off until you fill in its settings: see "Off-server backups" below. A file that did not change is stored only once across the 14 nights, so the uploads backup stays about as big as the uploads themselves plus what was added in two weeks. To bring back the uploads of one night: `sudo rsync -a /var/backups/agora/uploads-<date>/ /var/lib/agora/uploads/`.
- The warning when Agora is down (see "When Agora is down" below) works by itself once it is merged.
- Profile pictures, banners and attachments now work: they are kept on the server's own disk (see "Uploads"). The 80 GB disk holds them for a long time at 10 MB a file at most; `df -h /` shows how full it is.
- Anyone with an account can make a new circle. Decide whether only stewards should be able to.
- The script was written for Ubuntu 24.04 and checked line by line, but it has not run on a real VPS yet. The first run is the test.

## Off-server backups

Every night at 02:30 the server backs up the database and the uploads into `/var/backups/agora` (`agora/vps/backup.sh`). If the server itself is lost, those backups are lost with it. So the same script can also send each night's backup to **object storage** in the same Infomaniak Public Cloud project: a storage space for files, separate from the server, that speaks the same language as Amazon's S3. The tool that sends it is **rclone**, a well known copying program that comes with Ubuntu (`agora/vps/offsite-backup.sh`).

It is off until the settings file `/etc/agora/offsite-backup.conf` exists. Without it, the backup works as before and writes one line in its log: "Off-server copy: not set up".

**What is stored**, in a container (S3 says "bucket") called `agora-backups`:

- the database of every night, kept for 30 days (`OFFSITE_KEEP_DAYS`);
- the uploads as they are now, plus for 30 days the old version of every upload that was changed or deleted;
- the server's settings file `apps/backend/.env`, so a new server gets the same secrets and mail settings back. It holds every key, so it is only sent when encryption is on.

**Encryption.** Everything is encrypted on the server before it leaves (rclone's "crypt"), file names too. Infomaniak, or anyone who gets the storage keys, only sees scrambled data. The trade-off:

- The password must also be on the server, because the server encrypts every night. It protects the copy in storage, not a server that someone has broken into (such a person can read the live database anyway).
- **If the password is lost, nobody can ever read the copies, also not you.** Keep it in your password manager, next to the two storage keys.
- To use another password later, also use a new container name (`OFFSITE_BUCKET`), because old copies can only be read with the old password. Remove the old container once the new one has a few nights.
- Without encryption (`OFFSITE_ENCRYPT=no`) the files are readable for anyone with the storage keys, and the settings file is not sent. Not advised: the database holds the names, email addresses and messages of 7BP's members.

**What it costs.** Infomaniak charges about CHF 0.011 per GB per month for object storage (CHF 0.000015 per GB per hour on its price page), and sending data in is free. Agora's database is small (a few MB to some tens of MB), so 30 nights plus the uploads are likely a few GB: well under CHF 1 a month. Check the current price at infomaniak.com, Public Cloud, Prices.

### Switching it on (once, about 15 minutes)

You do this yourself; nobody else needs to see the keys or the password.

1. **Merge** the pull request and update the server, then install rclone and the example settings file in `/etc/agora` (the second command is only needed this first time; later updates do it themselves):
   ```
   sudo /srv/agora/agora/vps/update.sh
   sudo bash /srv/agora/agora/vps/offsite-backup.sh prepare
   ```
2. **Make storage keys.** Object storage keys are made with OpenStack's command line tool. The easiest place is the server itself:
   - In the Public Cloud dashboard (Horizon), open *API Access* and download the **OpenStack RC file** for the project. It holds no password.
   - Copy it to the server from your Mac: `scp ~/Downloads/<the file>-openrc.sh ubuntu@<the IP address>:`
   - On the server:
     ```
     sudo apt-get install -y python3-openstackclient
     source ~/<the file>-openrc.sh
     openstack ec2 credentials create
     ```
     `source` asks for the project's password. The last command prints two keys, `access` and `secret`. Put both in your password manager. (`openstack ec2 credentials list` shows them again later.)
3. **Choose an encryption password**: at least 20 characters, for example five random words. Put it in your password manager too.
4. **Make the settings file** and fill in the two keys and the password:
   ```
   sudo install -m 640 -o root -g agora /etc/agora/offsite-backup.conf.example /etc/agora/offsite-backup.conf
   sudo nano /etc/agora/offsite-backup.conf
   ```
   Save with Ctrl-O, Enter, and close with Ctrl-X. Only root can change this file and only Agora's own user can read it.
5. **Test it.** This makes the container `agora-backups` if it is not there yet, writes a test file, reads it back and removes it:
   ```
   sudo -u agora bash /srv/agora/agora/vps/offsite-backup.sh check
   ```
6. **Send the first copy now** instead of waiting for the night: `sudo systemctl start agora-backup`, then `sudo journalctl -u agora-backup -n 5` should end with "Off-server copy: done for ...".
7. Later, to see what is stored: `sudo -u agora bash /srv/agora/agora/vps/offsite-backup.sh list`.

If a night's copy fails (for example the storage cannot be reached), the backup on the server is still complete, and `sudo systemctl status agora-backup` shows "failed" with the reason. The next night tries again. Updates (`update.sh`) make a backup on the server only and do not wait for the copy.

### Restoring onto a new server

For when the server is lost or broken beyond repair. You need the two storage keys and the encryption password from your password manager.

1. Make a new instance as in "Going online" (steps 3 and 4), and point Agora's address at its new IP address. If the old server still runs somewhere, switch it off first: two servers must never send their copies to the same container.
2. Set it up as usual: `sudo bash setup-server.sh <Agora's address>`. This makes an empty Agora.
3. Make the settings file again, exactly as in steps 4 and 5 of "Switching it on", with the same keys, password and container name.
4. Fetch the newest backup (or add a date, such as `2026-10-19`, at the end for an older night; `list` shows which nights there are):
   ```
   sudo -u agora bash /srv/agora/agora/vps/offsite-backup.sh fetch /var/backups/agora/restore
   ```
5. Stop Agora while the data goes back:
   ```
   sudo systemctl stop agora-web agora-worker agora-api agora-backup.timer agora-cron-every10minutes.timer agora-cron-hourly.timer agora-cron-daily.timer
   ```
6. Put the database back. This throws away the empty database of step 2. Replace `<date>` with the date of the file in `/var/backups/agora/restore`:
   ```
   sudo -u postgres dropdb agora
   sudo -u postgres createdb -O agora agora
   sudo cat /var/backups/agora/restore/agora-<date>.dump | sudo -u postgres pg_restore --exit-on-error -d agora
   ```
7. Put the uploads back:
   ```
   sudo rsync -a /var/backups/agora/restore/uploads/ /var/lib/agora/uploads/
   ```
8. Put the old settings back, keeping only the new server's database password:
   ```
   sudo -u agora bash -c 'cd /srv/agora/apps/backend && db="$(grep "^DATABASE_URL=" .env)" && cp .env .env.new-server && cp /var/backups/agora/restore/settings/backend.env .env && sed -i "s|^DATABASE_URL=.*|$db|" .env'
   ```
   If Agora now has a different address than before, also change `DOMAIN` and `CORS_ALLOWED_ORIGINS` in that file (`sudo -u agora nano /srv/agora/apps/backend/.env`).
9. Bring the database up to date with the code and start everything again:
   ```
   cd /srv/agora/apps/backend && sudo -u agora -H env PATH=/opt/agora-node24/bin:/usr/bin:/bin COREPACK_ENABLE_DOWNLOAD_PROMPT=0 yarn migrate
   sudo systemctl start agora-api agora-worker agora-web agora-backup.timer agora-cron-every10minutes.timer agora-cron-hourly.timer agora-cron-daily.timer
   ```
10. Open Agora and log in. When everything looks right, remove the fetched copy: `sudo rm -rf /var/backups/agora/restore`.

The uploads come back as they were on the last night. An older version of a changed or deleted upload is in `uploads/changed-<date>` in the storage; `rclone` can fetch a single one if someone misses a file.

## When Agora is down

A server that is down cannot warn anyone, so the check runs elsewhere: on GitHub's computers, as a scheduled job in this repository (`.github/workflows/agora-uptime.yml`). Every 30 minutes it opens Agora's login page and asks Agora's server one small question (`/noo/graphql`, "who is logged in", which also answers when nobody is). If that fails three times in a row, two minutes apart, the job fails and GitHub emails you "Agora uptime check: All jobs have failed". While Agora stays down you get that email every 30 minutes; when it answers again the emails stop. While Agora is up, nobody is emailed. It costs nothing (public repositories get these jobs free) and needs no new account.

Things to know:

- The repository is public, so the job's log is public too. They only show the address and what the server answered; no keys are used.
- GitHub sometimes starts scheduled jobs late, by a few minutes up to an hour when it is busy. Fine for a volunteer site, not to the minute.
- GitHub pauses scheduled jobs in a public repository after **60 days without any change** to the repository, and emails you before it does. Then open *Actions*, *Agora uptime check*, and click *Enable workflow*.
- Check your email settings on GitHub once: *Settings*, *Notifications*, "Actions" by email on (only failed workflows).
- Try it by hand: *Actions*, *Agora uptime check*, *Run workflow*.
- When Agora moves to agora.7billionpresidents.org: *Settings*, *Secrets and variables*, *Actions*, *Variables*, add `AGORA_URL` with `https://agora.7billionpresidents.org`. No code change needed.

What to do when the email comes: open Agora yourself first. If it does not open, log in to the server and look: `sudo systemctl status agora-api agora-worker agora-web caddy`, then `sudo journalctl -u agora-api -n 50`. A restart often helps: `sudo systemctl restart agora-api agora-worker agora-web`. If the server itself does not answer to ssh, look at the instance in the Public Cloud dashboard (restart it there). If it is gone, see "Restoring onto a new server" above.

Other free options, if you ever want a second opinion or checks every few minutes: **UptimeRobot** (free plan: 50 checks every 5 minutes, email alerts; for personal and non-commercial use) and **Better Stack** (free plan: 10 checks every 3 minutes, email alerts). Both need an account of their own. Point either at `https://agora.guyvankoolwijk.nl/login`.

## Changing Agora

1. Make your change on your own computer and try it with the demo data.
2. Send it as a pull request on GitHub. Say in plain words what it does and how you tried it.
3. Two maintainers look at it before it is accepted. Anything that touches logging in, permissions or personal data also needs a review by an experienced developer.

Keep changes to Hylo's own files as small as possible, and mark them with a comment that starts with `Agora:`. New things go in new files. That way we can keep taking in Hylo's improvements.

## Licence

Hylo is published under the Apache 2.0 licence, and so is Agora. See [LICENSE.md](LICENSE.md). Agora is not affiliated with or endorsed by the Hylo team.
