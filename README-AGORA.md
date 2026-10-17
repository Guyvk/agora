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
| Each circle's Google Drive | A Files page per circle lists its Drive folder live: names, who changed a file and when. Files open in Drive | `apps/backend/agora/files.html`, `api/controllers/AgoraFilesController.js`, `lib/agora/drive.js` |
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

How Agora finds the folder: there is one main 7BP folder in Drive, and inside it a folder for each circle, named exactly like the circle in Agora. Capitals and extra spaces do not matter. Renaming a circle or its folder breaks the match until the other is renamed too. Agora never shows anything outside the main folder.

Agora reads Drive through a robot Google account, which Google calls a service account. It only ever reads. Setting it up, once:

1. **The folders.** In Google Drive, make the main folder and a folder per circle inside it.
2. **The robot account.** Go to [console.cloud.google.com](https://console.cloud.google.com), signed in with the 7BP Google account. Make a project called Agora. Under *APIs and services*, switch on the *Google Drive API*. Under *IAM and admin*, then *Service accounts*, create an account called `agora-drive-reader`, with no roles. Open it, choose *Keys*, *Add key*, *JSON*. Your browser downloads a key file. Keep it secret: anyone with it can read the main folder.
3. **Share.** Share the main folder with the robot account's email address (it ends in `iam.gserviceaccount.com`) as a *Viewer*. In a shared drive, add it as a member with the *Viewer* role.
4. **Tell Agora.** In `apps/backend/.env`, set `AGORA_DRIVE_FOLDER_ID` to the main folder's Drive link, and `AGORA_GOOGLE_SERVICE_ACCOUNT_KEY` to the key file in base64. In the Terminal, `base64 -i ~/Downloads/<the key file>.json | pbcopy` copies it, ready to paste. Then put the key file in the password manager and delete it from Downloads.
5. **Link it.** Restart Agora. In each circle's settings, a steward adds a link to its Files page to the circle's menu.

If you use Google Workspace, two settings of the organisation can get in the way: sharing with people outside the organisation, and, for organisations made after May 2024, making keys for robot accounts. Google switches the second off by default. A Workspace admin can allow both for this one project or folder.

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

Agora runs on one rented server in Switzerland: an Infomaniak **VPS Lite M** (2 processors, 4 GB memory, 80 GB disk, about 10 euros a month without VAT), with Ubuntu 24.04. One script sets everything up: the database, the job queue, Agora itself, https, the scheduled jobs (digests, reminders) and a nightly backup. The files are in `agora/vps/`.

**Once, before you start**

1. Make an ssh key on your Mac, if you have none yet: open Terminal and type `ssh-keygen -t ed25519`, then press Enter three times. Your public key is in `~/.ssh/id_ed25519.pub`. That file is safe to share; the other one (without `.pub`) never leaves your Mac.
2. In the Infomaniak Manager, order a **VPS Lite**, size **M**, with **Ubuntu 24.04**. When it asks for an ssh key, paste the contents of `id_ed25519.pub`.
3. Note the server's IP address (Manager, your VPS, overview).
4. In the Infomaniak Manager, open the VPS firewall and allow ports 22 (ssh), 80 (http) and 443 (https).
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

- Sign up yourself first. Until a mailbox is connected, emails are written to the log instead of sent, so read your sign-up code with `sudo journalctl -u agora-worker -n 50`.
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

- The nightly backups (`/var/backups/agora`, 14 days) sit on the same server. A second copy elsewhere, for example Infomaniak's Swiss Backup, is not set up yet.
- Profile pictures and other uploads inside Hylo still expect Amazon S3. Until Swiss Backup or Google Drive takes that over, those uploads do not work.
- Anyone who finds the address can sign up and make a circle. Before inviting people, decide whether sign-ups should need an invitation.
- The script was written for Ubuntu 24.04 and checked line by line, but it has not run on a real VPS yet. The first run is the test.

## Changing Agora

1. Make your change on your own computer and try it with the demo data.
2. Send it as a pull request on GitHub. Say in plain words what it does and how you tried it.
3. Two maintainers look at it before it is accepted. Anything that touches logging in, permissions or personal data also needs a review by an experienced developer.

Keep changes to Hylo's own files as small as possible, and mark them with a comment that starts with `Agora:`. New things go in new files. That way we can keep taking in Hylo's improvements.

## Licence

Hylo is published under the Apache 2.0 licence, and so is Agora. See [LICENSE.md](LICENSE.md). Agora is not affiliated with or endorsed by the Hylo team.
