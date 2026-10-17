# Agora

Agora is the online home of 7 Billion Presidents: one place for circles, people, meetings, decisions and files. It is built on [Hylo](https://github.com/Hylozoic/hylo), an open source community platform, and adds a few things of its own.

"Agora" was the square where the citizens of ancient Greece met to talk and decide. In Portuguese the same word means "now".

This file explains what Agora adds to Hylo, how to run it on a Mac, and how to change it. It is written for people who are not programmers.

## What Agora adds to Hylo

| Addition | What it does | Where the code lives |
| --- | --- | --- |
| Meetings that write their own minutes | Every event has a meeting room. While people speak, their own browser turns their speech into text. When the meeting ends, the assistant posts the minutes in the group | `apps/backend/agora/meeting-room.html`, `api/controllers/MeetingController.js`, `api/models/Meeting*.js`, `api/services/Transcription.js`, `api/services/MeetingMinutes.js` |
| Our own email sender | Hylo's emails are stored in Hylo's own account, so a copy of Hylo cannot send them. Agora has its own texts for sign-up, password reset, invitations and join requests | `apps/backend/lib/agora/mailer.js` |
| Our own name | The browser title, the loading screen (with the 7 Billion Presidents mark) and the English texts say Agora | `apps/web/public/locales/en.json`, `apps/web/index.html`, `apps/web/public/agora-7bp-logo.png` |
| No landing site | Visitors who are not logged in go straight to the login page | `apps/web/src/server/proxy.js` |
| Each circle's Google Drive | A Files page per circle lists its Drive folder live: names, who changed a file and when. Files open in Drive. Members of the circle can add files and folders, which go straight into Drive | `apps/backend/agora/files.html`, `api/controllers/AgoraFilesController.js`, `lib/agora/drive.js` |
| Contacts | One shared list of the people and organisations 7BP works with outside Agora, with notes, follow-ups and a log of every change | `apps/web/src/agora/contacts/`, `apps/backend/api/controllers/AgoraContactsController.js`, `apps/backend/lib/agora/contacts.js` |
| Demo data | A made-up 7BP with circles, people, playbook proposals and meetings | `apps/backend/scripts/agora-demo.js` |
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

## Meetings

Open any event and choose **Meet in Agora, with minutes**. The meeting room asks whether your voice may be part of the notes, then opens the call.

When you schedule an event and leave its video call link empty, Agora fills in the event's meeting room. That link then also appears in invitations, emails and calendar entries, so everyone lands in the same room. If you type a link of your own, for example for Zoom, Agora leaves it alone. This only happens when `AGORA_MEET_DOMAIN` is set. Events made before this was added keep an empty link until they are edited.

How it works:

1. The call itself runs on a Jitsi server, shown inside the room. The server is set with `AGORA_MEET_DOMAIN`. The default is kMeet by Infomaniak.
2. While you are unmuted, your browser records short pieces of your own speech and skips silence. Because each person records only their own microphone, Agora always knows who said what.
3. Each piece is sent to a speech-to-text service and becomes a line in the notes. The sound is deleted as soon as it has become text.
4. When someone ends the meeting, or when it has been quiet for 45 minutes, Claude reads the transcript and writes the minutes: a summary, decisions, actions and open questions. The assistant posts them in the group, with the full transcript underneath.

Three settings in `apps/backend/.env` switch this on:

| Setting | What to put there |
| --- | --- |
| `AGORA_TRANSCRIPTION_URL` and `AGORA_TRANSCRIPTION_KEY` | The address and key of a speech-to-text service. Any service that follows the OpenAI format works, for example Infomaniak AI Tools (Whisper, hosted in Switzerland) |
| `ANTHROPIC_API_KEY` | A key from a Claude developer account, for writing the minutes |
| `AGORA_MEET_DOMAIN` | The Jitsi server for the call. Leave empty to open the event's own video link in a second window |

Without the first, meetings work but no notes are written. Without the second, you get the transcript without a summary.

Things to know:

- **Use headphones.** Without them, your microphone can pick up other people's voices from your speakers, and their words may appear under your name.
- **Phones.** The room is laid out for phones, but recording next to a call has not been tested on phone browsers yet.
- **kMeet.** Showing kMeet inside another page works today, but Infomaniak does not document it as a supported use. If it stops working, set another Jitsi server.
- **Consent.** People choose on entering whether their voice is in the notes, and can pause at any time. Agree as a group that meetings are transcribed before using this for real.

## Google Drive

Each circle has a Files page at `/noo/agora/files/<circle>`, where `<circle>` is the last part of the circle's address in Agora (for example `7bp-governance` in `/groups/7bp-governance`). It lists the circle's Drive folder: names, who changed a file last and when. Clicking a file opens it in Google Drive, so Drive keeps deciding who may read or edit it. Anyone logged in to Agora can see every circle's Files page. They see the names of all files, including files they cannot open.

How Agora finds the folder: there is one main 7BP folder in Drive, and inside it a folder for each circle, named exactly like the circle in Agora. Capitals and extra spaces do not matter. Renaming a circle or its folder breaks the match until the other is renamed too. Agora never shows or adds anything outside the main folder.

### Adding files from Agora

When adding is switched on (`AGORA_DRIVE_UPLOADS=on`), members of a circle see three buttons on its Files page:

- **Add files**: pick one or more files. They go into the folder that is open and show up in the list when they are done. Files can also be dropped on the list.
- **New folder**: makes a folder in the folder that is open.
- **My folder**: opens the folder with your own name in the folder that is open, and makes it the first time. This is how 7BP works in Drive today: each person puts photos and videos in a folder under their own name.

Only members of that circle can add to its folder; everyone else still only sees the list. Agora never changes, moves or deletes what is already in Drive.

Big videos are fine, up to 5 GB a file (`AGORA_DRIVE_MAX_UPLOAD_MB`). They do not pass through Agora: Agora checks that you are a member, asks Google for a one-time upload address for that one file in that one folder, and your browser sends the file straight to Google in pieces of 8 MB, with a percentage on screen. If the connection breaks, a piece is tried again. Keep the page open until it says "Added"; the browser asks before you leave halfway. If a browser cannot send to Google directly, files up to 25 MB go through Agora's server instead, and bigger ones have to be put in Drive by hand. Whether browsers can send to Google directly has been tested with a pretend Google only, so try it with one real big video first.

In Drive, an added file belongs to Agora's Google account. The Files page shows the name of the member who added it.

**Travel receipts and tickets.** These often carry bank account numbers (IBANs), amounts and travel details: financial personal data. Keep them out of Agora's Files pages until 7BP has agreed how it handles personal data (see "Contacts"), or keep them in a folder that is not inside the main folder, so Agora never shows them.

### Which Google account Agora uses

Google does not let a robot account (a "service account") store files in a normal Drive, because a robot has no storage of its own. So there are two ways:

| | Way 1: a shared drive | Way 2: a Google account for 7BP |
| --- | --- | --- |
| Needs | Google Workspace for 7BP. Nonprofits can get it free through [Google for Nonprofits](https://www.google.com/nonprofits/), with far more storage than one account | A normal Google account made only for 7BP, for example `agora.7bp@gmail.com`. Free with 15 GB, which a few videos fill. Google One sells more (2 TB for about 10 euros a month) |
| Where files live | A shared drive, owned by 7BP as an organisation | The "My Drive" of that account |
| Agora logs in with | A robot account and its key | That account, which allowed Agora in once |
| Choose it when | 7BP has or gets Workspace. This is the better way | 7BP has no Workspace |

Do not use your own personal Google account for way 2: Agora would then be allowed into all of your own Drive. The code only looks inside the main folder, but the permission would be there.

Ask the founder first whether 7BP has Google Workspace. Then follow one of the two.

### Way 1, a shared drive (with Google Workspace)

1. **The shared drive.** In Google Drive, signed in with the 7BP Workspace account, choose *Shared drives*, *New*, and call it `7BP Agora`. Inside it, make a folder per circle, named exactly like the circle in Agora. This shared drive is the main folder.
2. **The robot account.** Go to [console.cloud.google.com](https://console.cloud.google.com), signed in with the 7BP account. Make a project called Agora. Under *APIs and services*, switch on the *Google Drive API*. Under *IAM and admin*, then *Service accounts*, create an account called `agora-drive`, with no roles. Open it, choose *Keys*, *Add key*, *JSON*. Your browser downloads a key file. Keep it secret: anyone with it can read and add to the main folder. For organisations made after May 2024, Google blocks making keys: a Workspace admin allows it for this one project (the policy is called *Disable service account key creation*).
3. **Share.** Open the shared drive, choose *Manage members*, and add the robot account's email address (it ends in `iam.gserviceaccount.com`) as *Contributor*. Contributor can add files but cannot delete anything. For reading only, *Viewer* is enough.
4. **Tell Agora.** In `apps/backend/.env`, set `AGORA_DRIVE_FOLDER_ID` to the shared drive's link (open it in Drive and copy the address), `AGORA_GOOGLE_SERVICE_ACCOUNT_KEY` to the key file in base64, and `AGORA_DRIVE_UPLOADS=on`. In the Terminal, `base64 -i ~/Downloads/<the key file>.json | pbcopy` copies the key, ready to paste. Then put the key file in the password manager and delete it from Downloads.
5. Restart Agora, and see "Link it" below.

If sharing with people outside the organisation is switched off in Workspace, a Workspace admin allows it for this shared drive.

### Way 2, a Google account for 7BP (without Workspace)

1. **The account.** Make a new Google account for 7BP at [accounts.google.com](https://accounts.google.com), for example `agora.7bp@gmail.com`. Put its password in the password manager, and give two other key holders access, like every outside account.
2. **The folders.** Signed in as that account, make the main folder in its Google Drive, called `7BP Agora`, and a folder per circle inside it, named exactly like the circle in Agora. Share the main folder with the people who should also see it in Drive. Folders that someone else owns also work, if they share them with this account as *Editor*.
3. **The project.** Go to [console.cloud.google.com](https://console.cloud.google.com), signed in as that account. Make a project called Agora. Under *APIs and services*, switch on the *Google Drive API*.
4. **The login screen.** Under *APIs and services*, then *OAuth consent screen* (newer screens call it *Google Auth Platform*): choose *External*, app name `Agora`, and the account's own email address for both contact fields. Skip the scopes and test users. Then, under *Audience*, choose **Publish app** and confirm. This step matters: while the app is in "Testing", Google ends Agora's login after seven days. Google does not need to check the app, because only this one account ever logs in to it.
5. **The login client.** Under *Clients* (or *Credentials*, *Create credentials*, *OAuth client ID*), make a client of the type **Desktop app**, called `Agora`. Google shows a client ID and a client secret. Put them in `apps/backend/.env` yourself, as `AGORA_GOOGLE_OAUTH_CLIENT_ID` and `AGORA_GOOGLE_OAUTH_CLIENT_SECRET`. Also set `AGORA_DRIVE_FOLDER_ID` to the main folder's Drive link and `AGORA_DRIVE_UPLOADS=on`.
6. **Let Agora in.** In the Terminal, in the Agora folder, run `node agora/google-drive-login.mjs`. Your browser opens Google's login page. Log in as the 7BP account, not your own. Google warns that it has not verified the app: choose *Advanced*, then *Go to Agora*, then *Continue*. The script writes `AGORA_GOOGLE_OAUTH_REFRESH_TOKEN` into `apps/backend/.env` without showing it, and says which account it used.
7. Restart Agora, and see "Link it" below.

If Agora ever says Google refused its login, for example after the account's password was changed, run step 6 again.

### Link it

In each circle's settings, a steward adds a link to its Files page to the circle's menu. Online, the settings above go into Heroku as well, see "Going online".

## Contacts

The Contacts button in the bar on the left opens the Contacts page (`/contacts`), part of Agora like Messages: one shared list of the people and organisations 7BP works with outside Agora: partners, press, funders and people who are interested. The number on the button is how many of your follow-ups are due.

- For each contact: name, organisation, kind, email, phone, website, status, the circle that mainly deals with them, where their details came from, and whether they agreed to be contacted.
- Notes keep what was said or done, with who wrote them and when.
- A follow-up is a next step with a date and a person. "My follow-ups" lists yours.
- Every Agora member, meaning everyone in at least one circle, can read, add, change and delete contacts. Every change is logged with who made it and which fields changed, never what they said. Deleting a contact removes the person and their notes for good.

These are people who never signed up to Agora, so their details are personal data under the GDPR. 7BP needs a reason to keep them, has to delete anyone who asks, and has to answer when someone asks what is kept about them. Before real contacts go in, an experienced developer looks at this part, and 7BP agrees who answers such questions. Until then, only the made-up demo contacts are in it.

## Email

On your own computer no email is sent. Every email is printed in the Terminal instead, so you can copy sign-up codes and links from there.

To send real email, set `AGORA_EMAIL_TRANSPORT=brevo`, `BREVO_API_KEY` and `EMAIL_SENDER` in `apps/backend/.env`. Sending through Brevo has been written but not yet tried against a real account.

Emails that Agora has no text for yet, such as event invitations and digests, are not sent. A line in the log says so. Notification emails stay off while `EMAIL_NOTIFICATIONS_ENABLED=false`.

## What is switched off

- **Tracking.** `DISABLE_SEGMENT=1` stops the server from sending usage events to Segment. The Mixpanel and Intercom keys are empty. The cookie banner still mentions them and needs to be changed.
- **Payments.** Not used. The server insists on a `STRIPE_SECRET_KEY`, so the settings file holds a placeholder.
- **Uploads.** Pictures and attachments need a storage bucket and a Filestack key, which are not set up yet. Files live in Google Drive. The plan is to store uploads with Infomaniak's Swiss Backup later, with an upload button of our own.
- **The Commons.** Hylo's public area, with public posts, a public group directory and a public map. Agora has nothing public yet, so its button and tab are hidden and its pages go to My Home. One switch in `apps/web/src/agora/config.js` brings it back.
- **Phone apps and push notifications.** Agora is a website.

## Going online

Prepared, not done yet. Agora goes on Heroku, in its EU region (Dublin), and later at `agora.7billionpresidents.org`. One script does the work: `./agora/heroku-setup.sh`. Run without anything after it, it only shows every step and what it costs, and changes nothing.

**How it is laid out.** Two Heroku apps, the way Hylo runs:

| App | What runs there |
| --- | --- |
| `agora-7bp` | The web app: the pages people open. It passes every `/noo` call on to the server app |
| `agora-7bp-api` | The server, its background worker (minutes, emails), the database (Heroku Postgres), Redis (Redis Cloud) and a timer (Heroku Scheduler) |

**What it costs**, per month, at Heroku's prices of October 2026: three Basic dynos at 7 dollars (server, worker, web app), the smallest database at 5 dollars, Redis Cloud's free 30 MB plan, and a few cents for the timer. About 27 dollars a month. Google Drive storage is separate, see "Google Drive".

**Steps**, in the Terminal, in the Agora folder:

1. `heroku login`, once. It opens the browser to log in to Heroku.
2. `./agora/heroku-setup.sh` shows the plan. Read it.
3. `./agora/heroku-setup.sh create` makes the two apps, the database, Redis and the timer, and puts in the settings. Fresh secrets for cookies and logins are made on the spot and go straight into Heroku, never shown and never the ones from the Mac. This is where Heroku starts charging.
4. Add the keys of other services from `apps/backend/.env`, without showing them: `./agora/heroku-setup.sh secret BREVO_API_KEY`, and the same for the Google Drive settings (`AGORA_DRIVE_FOLDER_ID`, then `AGORA_GOOGLE_SERVICE_ACCOUNT_KEY` or the three `AGORA_GOOGLE_OAUTH_...` ones), `ANTHROPIC_API_KEY`, `AGORA_TRANSCRIPTION_URL` and `AGORA_TRANSCRIPTION_KEY`. Settings that are not secret can also be set with `heroku config:set -a agora-7bp-api AGORA_DRIVE_UPLOADS=on`. To send real email, also `AGORA_EMAIL_TRANSPORT=brevo` and an `EMAIL_SENDER` that Brevo accepts.
5. `./agora/heroku-setup.sh deploy` sends the branch `agora` to both apps. From then on Agora is online, at the address the script prints. The first time, the server fills the empty database by itself (`scripts/agora-init-db.js`). There is no demo data online, and there must never be: `scripts/agora-demo.js` refuses when `NODE_ENV=production`.
6. Once, in the Heroku dashboard: the server app, *Resources*, *Heroku Scheduler*, add the three jobs the script prints (every 10 minutes, every hour, every day). The 10-minute one ends quiet meetings so their minutes get written.
7. When the domain is ready: `./agora/heroku-setup.sh domain`. Whoever holds the login of `7billionpresidents.org` adds the two DNS records it prints, then deploy once more. Until then, live updates (a new chat message appearing by itself) do not work, because the login cookie cannot be shared between two `herokuapp.com` addresses.

Things that were sorted out for this:

- The server kept up to 30 database connections per program; the smallest Heroku database allows 20 for everything together. `DB_POOL_MAX` and `DB_POOL_MIN` in `apps/backend/knexfile.js` now set this; online it is 5 per program.
- Heroku builds only the server or only the web app (`YARN2_WORKSPACE_PATH`), with its own Procfile from `agora/heroku/`, and skips the phone and desktop apps' downloads.
- Heroku's own Redis needs an encrypted connection, which Hylo's job queue cannot make. Redis Cloud's plan works without.

Not tried yet, because nothing has been deployed: whether the first build fits in Heroku's time and size limits (the code base is large), and whether 512 MB of memory per dyno is enough for the server. If a build or the server runs out, the script's `AGORA_HEROKU_DYNO=standard-2x` (50 dollars per dyno) is the bigger size.

**Before real people's data goes online.** Heroku's EU region keeps the data in the EU. Still, before the Contacts page holds real contacts, the privacy review in `AGORA-STATUS.md` has to happen first. Travel receipts with bank details stay out of the Files pages for now, see "Google Drive".

## Changing Agora

1. Make your change on your own computer and try it with the demo data.
2. Send it as a pull request on GitHub. Say in plain words what it does and how you tried it.
3. Two maintainers look at it before it is accepted. Anything that touches logging in, permissions or personal data also needs a review by an experienced developer.

Keep changes to Hylo's own files as small as possible, and mark them with a comment that starts with `Agora:`. New things go in new files. That way we can keep taking in Hylo's improvements.

## Licence

Hylo is published under the Apache 2.0 licence, and so is Agora. See [LICENSE.md](LICENSE.md). Agora is not affiliated with or endorsed by the Hylo team.
