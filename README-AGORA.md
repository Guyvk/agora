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
| Each circle's Google Drive | A Files page per circle lists its Drive folder live: names, who changed a file and when. Files open in Drive. Members of the circle can add files and folders, which go straight into Drive | `apps/backend/agora/files.html`, `api/controllers/AgoraFilesController.js`, `lib/agora/drive.js` |
| Contacts | One shared list of the people and organisations 7BP works with outside Agora, with notes, follow-ups and a log of every change | `apps/web/src/agora/contacts/`, `apps/backend/api/controllers/AgoraContactsController.js`, `apps/backend/lib/agora/contacts.js` |
| Sign-up by invitation | A new account needs an invitation to a circle: the link in an invitation email, or a circle's join link. People who already have an account log in as before | `apps/backend/lib/agora/signup.js`, `apps/web/src/agora/signup.js` |
| Playbook | A page in each group with every chapter of its playbook: owner, status, last change, a short text and a link. Stewards change it, members read it | `apps/web/src/agora/playbook/`, `apps/backend/lib/agora/playbook.js`, `apps/backend/api/graphql/agora/` |
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

Open any event and choose **Meet in Agora, with minutes**. The meeting room asks whether your voice may be part of the notes, then opens the call.

Video calls in Agora always go through the event's own meeting room. There is no field for a video call link on an event: Agora gives every event its meeting room as its link, and that link also appears in invitations, emails and calendar entries, so everyone lands in the same room. A link to another platform (Zoom, Google Meet, Teams, Webex, Whereby and the like) cannot be added. The event form has no field for it, the server replaces whatever an app or the API sends, and such a link is refused as an event's location. When `AGORA_MEET_DOMAIN` is empty there is no call server, so events have no video call link at all.

**Older events.** Events made before this can still have a Zoom link, or no link. One command, in `apps/backend` (on the server: `/srv/agora/apps/backend`, as the `agora` user), shows what it would change and saves nothing:

```
node scripts/agora-meeting-links.js
```

Then the same with `--apply` makes the changes: every event gets its meeting room as its link, and an event whose location is only a video call link gets an empty location. A location with more in it (an address and a Zoom link) is listed, for a steward to change by hand. Nobody gets an email; calendars show the meeting room once the worker has made the calendar files again. Running it a second time changes nothing.

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
| `AGORA_MEET_DOMAIN` | The Jitsi server for the call: `kmeet.infomaniak.com` (kMeet by Infomaniak). Every call runs here. If the call cannot be shown inside the room, the room offers the same kMeet room in a second window. Leave empty only to have no video calls at all: then events have no video call link, and the room only writes notes for people sitting together |

Without the first, meetings work but no notes are written. Without the second, you get the transcript without a summary.

Things to know:

- **Use headphones.** Without them, your microphone can pick up other people's voices from your speakers, and their words may appear under your name.
- **Phones.** The room is laid out for phones, but recording next to a call has not been tested on phone browsers yet.
- **kMeet.** Showing kMeet inside another page works today, but Infomaniak does not document it as a supported use. If it stops working, set another Jitsi server.
- **Consent.** People choose on entering whether their voice is in the notes, and can pause at any time. Agree as a group that meetings are transcribed before using this for real.

## Guests in a meeting

Members can invite people who have no Agora account into a meeting, so the call still happens in Agora.

**Making a link.** Open the event. The person who made the event and the stewards of its circle (anyone with Administration or Manage Content there) see a box "Guests from outside Agora" under the event. **Make a guest link** shows the link with a **Copy** button. Send it to the guests by email or chat. Other members do not see the box.

- Agora keeps only a fingerprint (a sha256 hash) of the link, never the link itself. So the link is shown only once, right after it is made. If it is lost, make a new one: the old one stops working at once, and guests who came in through it are sent out within seconds.
- The link works until two hours after the event ends (an event without an end time counts as one hour long). Change the event's time before making the link, or make a new link after changing it.
- **Revoke** closes the link. Guests in the call are sent out within seconds.
- There is one link per event. It only works while members are in the meeting: a guest who comes early waits, and the page tries again by itself.
- Guest links need the call inside Agora (`AGORA_MEET_DOMAIN`). Without it the box says so.

**What the guest sees.** The link opens a page that asks for their name (at most 60 letters, digits and spaces) and explains, in plain words, that the meeting is held in Agora by 7 Billion Presidents, that if they agree their speech is turned into text by Infomaniak (Switzerland), that the minutes are written by Claude (Anthropic, United States) and posted inside the circle with their name followed by "(guest)". They choose **Join, and agree to be in the notes** or **Join without being in the notes**. Without the notes their microphone is never recorded by Agora. Then they get the same kMeet call as members, with "(guest)" after their name. They see the call and a Leave button. They never see the notes, the transcript, the minutes, the event page or anything else in Agora.

**What members see.** Guests appear in the "Here:" line and in the notes as "Name (guest)". The minutes post lists them on a separate line, "Guests (joined through the guest link, not members of Agora)".

**Safety checks** (in `lib/agora/meetingGuests.js` and `api/controllers/MeetingGuestController.js`, tested in `test/unit/agora/meetingGuests.test.js`):

- The link's secret is 32 random bytes. It is checked against the stored hash in constant time. Wrong, old, revoked and expired links are refused.
- Each guest who joins gets a second secret of their own, so one guest cannot speak under another guest's name.
- Guests can only do five things: open the page, join, send their own speech (only if they agreed), ask whether the meeting is still going, and leave. Leaving never ends the meeting for others. The member calls (notes, ending the meeting, making links) still need a login.
- Calls are counted per internet address: 30 page views, 10 joins, 10 leaves a minute (and 60 joins a minute for all guests of one link together), and per guest 60 pieces of speech and 40 status checks a minute. An address that tries 20 wrong links in 10 minutes is refused for a while. At most 50 guests per meeting. The counts live in the server's memory, so a restart resets them.
- The guest page tells the browser never to send its address on to other sites (`Referrer-Policy: no-referrer`) and never to keep it.
- The link sits in the page's address, so it can show up in the web server's access log on the server. Treat those logs as private.

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

The Contacts button in the bar on the left opens the Contacts page (`/contacts`), part of Agora like Messages: one shared list of the people and organisations 7BP works with outside Agora: partners, press, funders and people who are interested. The number on the button is how many of your follow-ups are due.

- For each contact: name, organisation, kind, email, phone, website, status, the circle that mainly deals with them, where their details came from, and whether they agreed to be contacted.
- Notes keep what was said or done, with who wrote them and when.
- A follow-up is a next step with a date and a person. "My follow-ups" lists yours.
- Every Agora member, meaning everyone in at least one circle, can read, add, change and delete contacts. Every change is logged with who made it and which fields changed, never what they said. Deleting a contact removes the person and their notes for good.

These are people who never signed up to Agora, so their details are personal data under the GDPR. 7BP needs a reason to keep them, has to delete anyone who asks, and has to answer when someone asks what is kept about them. Before real contacts go in, an experienced developer looks at this part, and 7BP agrees who answers such questions. Until then, only the made-up demo contacts are in it.

## Who can sign up

Agora is by invitation. Only someone who holds an invitation to a circle can make an account:

- the link in an invitation email that a steward of a circle sent. It only makes an account for the email address it was sent to, so a forwarded link does not let anyone else in. It stops working once the person has joined the circle with it, or when the steward withdraws it. Or:
- a circle's join link. Anyone who has it can make an account, with any email address, as many times as they like, until a steward makes a new link or the circle is deleted. Share it only with people you would invite anyway.

Someone who opens the sign-up page without one reads "Agora is by invitation" and is asked to get an invitation from a 7BP steward. The server checks this too, so it cannot be skipped by going around the web page. A first login with Google, Facebook or LinkedIn is always refused while sign-up is by invitation (Agora does not show those buttons). People who already have an account are not affected and log in as before.

The setting is `AGORA_INVITE_ONLY` in `apps/backend/.env`: `on` or `off`. Left empty, it is on for a server and off on your own computer, so demo sign-ups keep working there. `off` brings back Hylo's way: anyone who finds the address can sign up.

**Making a circle.** Anyone with an account can still make a new circle, as in Hylo. Whether only stewards should be able to is an open question.

**Letting one person in without a circle.** On the server, in `/srv/agora/apps/backend`:

```
sudo -u agora -H env PATH=/opt/agora-node24/bin:/usr/bin:/bin node scripts/agora-allow-signup.js someone@example.org
```

It prints a sign-up link that works for 4 hours (and also emails it, once a mailbox is connected). Opening the link confirms the address and goes on to choosing a name and password. Keep the link private: it logs in as that address. This is how the first person gets in, see "After the setup" below.

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

## Email

On your own computer no email is sent. Every email is printed in the Terminal instead, so you can copy sign-up codes and links from there.

To send real email, set `AGORA_EMAIL_TRANSPORT=brevo`, `BREVO_API_KEY` and `EMAIL_SENDER` in `apps/backend/.env`. Sending through Brevo has been written but not yet tried against a real account.

Emails that Agora has no text for yet, such as event invitations and digests, are not sent. A line in the log says so. Notification emails stay off while `EMAIL_NOTIFICATIONS_ENABLED=false`.

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

A server that is down cannot warn anyone, so the check runs elsewhere: on GitHub's computers, as a scheduled job in this repository (`.github/workflows/agora-uptime.yml`). Every 30 minutes it opens Agora's login page and asks Agora's server one small question (`/noo/graphql`, "who is logged in", which also answers when nobody is). If that fails three times in a row, two minutes apart, it opens an issue **"Agora is down"** on GitHub, assigned to you, so GitHub emails you. While Agora stays down, nothing more is sent. When Agora answers again, it writes a comment and closes the issue, which sends a second email. It costs nothing (public repositories get these jobs free) and needs no new account.

Things to know:

- The repository is public, so the issues and the job's log are public too. They only show the address and what the server answered; no keys are used.
- GitHub sometimes starts scheduled jobs late, by a few minutes up to an hour when it is busy. Fine for a volunteer site, not to the minute.
- GitHub pauses scheduled jobs in a public repository after **60 days without any change** to the repository, and emails you before it does. Then open *Actions*, *Agora uptime check*, and click *Enable workflow*.
- Check your email settings on GitHub once: *Settings*, *Notifications*, "Issues" or "Participating" by email on.
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
