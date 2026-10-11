# Agora

Agora is the online home of 7 Billion Presidents: one place for circles, people, meetings, decisions and files. It is built on [Hylo](https://github.com/Hylozoic/hylo), an open source community platform, and adds a few things of its own.

"Agora" was the square where the citizens of ancient Greece met to talk and decide. In Portuguese the same word means "now".

This file explains what Agora adds to Hylo, how to run it on a Mac, and how to change it. It is written for people who are not programmers.

## What Agora adds to Hylo

| Addition | What it does | Where the code lives |
| --- | --- | --- |
| Meetings that write their own minutes | Every event has a meeting room. While people speak, their own browser turns their speech into text. When the meeting ends, the assistant posts the minutes in the group | `apps/backend/agora/meeting-room.html`, `api/controllers/MeetingController.js`, `api/models/Meeting*.js`, `api/services/Transcription.js`, `api/services/MeetingMinutes.js` |
| Our own email sender | Hylo's emails are stored in Hylo's own account, so a copy of Hylo cannot send them. Agora has its own texts for sign-up, password reset, invitations and join requests | `apps/backend/lib/agora/mailer.js` |
| Our own name | The browser title and the English texts say Agora | `apps/web/public/locales/en.json`, `apps/web/index.html` |
| No landing site | Visitors who are not logged in go straight to the login page | `apps/web/src/server/proxy.js` |
| Demo data | A made-up 7BP with circles, people, playbook proposals and meetings | `apps/backend/scripts/agora-demo.js` |
| Setup scripts | One command to set everything up on a Mac | `agora/` |

Everything Agora changed in Hylo's own files is listed in [AGORA-CHANGES.md](AGORA-CHANGES.md).

## Run Agora on your Mac

You need [Homebrew](https://brew.sh) and about 10 GB of free disk space. Then, in the Terminal, from this folder:

```bash
./agora/setup-mac.sh
```

This installs the tools, creates the database, writes the settings files and adds demo data. It takes ten to twenty minutes the first time. It is safe to run again.

Start Agora with:

```bash
./agora/start.sh
```

Open http://localhost:3000 and log in as `steward@agora.test`. The password is in the file `apps/backend/.agora-demo-login`. The other made-up people (amara, lars, sofia, kenji, priya, all `@agora.test`) use the same password.

Press Ctrl-C in the Terminal to stop Agora.

> The setup script was written and checked on Linux. It has not yet been run on a Mac. If a step fails, the message on screen says which one, and the step can be done by hand.

## Meetings

Open any event and choose **Meet in Agora, with minutes**. The meeting room asks whether your voice may be part of the notes, then opens the call.

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

## Email

On your own computer no email is sent. Every email is printed in the Terminal instead, so you can copy sign-up codes and links from there.

To send real email, set `AGORA_EMAIL_TRANSPORT=brevo`, `BREVO_API_KEY` and `EMAIL_SENDER` in `apps/backend/.env`. Sending through Brevo has been written but not yet tried against a real account.

Emails that Agora has no text for yet, such as event invitations and digests, are not sent. A line in the log says so. Notification emails stay off while `EMAIL_NOTIFICATIONS_ENABLED=false`.

## What is switched off

- **Tracking.** `DISABLE_SEGMENT=1` stops the server from sending usage events to Segment. The Mixpanel and Intercom keys are empty. The cookie banner still mentions them and needs to be changed.
- **Payments.** Not used. The server insists on a `STRIPE_SECRET_KEY`, so the settings file holds a placeholder.
- **Uploads.** Pictures and attachments need a storage bucket and a Filestack key, which are not set up yet. Files live in Google Drive.
- **Phone apps and push notifications.** Agora is a website.

## Going online

Not done yet. The plan is Heroku in the EU region, at `agora.7billionpresidents.org`. Before the first deploy:

- The server keeps up to 30 database connections open per process, which is more than Heroku's smallest database plan allows. Either lower the pool in `apps/backend/knexfile.js` or take the next plan up.
- `OIDC_KEYS`, `COOKIE_SECRET` and `JWT_SECRET` must be made fresh for the online copy. Never reuse the ones from your Mac.
- Never run `scripts/agora-demo.js` on the real Agora. It refuses when `NODE_ENV=production`.

## Changing Agora

1. Make your change on your own computer and try it with the demo data.
2. Send it as a pull request on GitHub. Say in plain words what it does and how you tried it.
3. Two maintainers look at it before it is accepted. Anything that touches logging in, permissions or personal data also needs a review by an experienced developer.

Keep changes to Hylo's own files as small as possible, and mark them with a comment that starts with `Agora:`. New things go in new files. That way we can keep taking in Hylo's improvements.

## Licence

Hylo is published under the Apache 2.0 licence, and so is Agora. See [LICENSE.md](LICENSE.md). Agora is not affiliated with or endorsed by the Hylo team.
