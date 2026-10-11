# What Agora changed in Hylo

Agora is a modified copy of [Hylo](https://github.com/Hylozoic/hylo), which is published under the Apache 2.0 licence. This file lists every Hylo file that Agora changed, as that licence asks. It is kept up to date with each change.

Started from Hylo's `dev` branch at commit `58f7666` (10 October 2026).

## Hylo files that were changed

| File | What changed |
| --- | --- |
| `apps/backend/api/services/Email.js` | Uses Agora's own email sender when no SendWithUs key is set |
| `apps/backend/config/routes.js` | Added the addresses of the meeting room |
| `apps/backend/config/policies.js` | Added who may use the meeting room |
| `apps/backend/api/services/Websockets.js` | Fixed an error on shutdown. This one is worth offering back to Hylo |
| `apps/backend/cron.js` | Ends meetings that have gone quiet, so their minutes get written |
| `apps/backend/migrations/schema.sql` | Added the three meeting tables |
| `apps/backend/.env.example` | Added Agora's settings |
| `apps/backend/package.json` | Told the style checker about the new model and service names |
| `apps/web/.env.example` | `PROXY_HOST` is empty by default |
| `apps/web/index.html` | Browser title says Agora |
| `apps/web/public/locales/en.json` | English texts say Agora where they said Hylo |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.js` | Events show a link to their Agora meeting room |
| `apps/web/src/server/proxy.js` | Without a landing site, visitors who are not logged in go to the login page |
| `apps/web/src/routes/**` (11 files) | Browser tab titles end in "Agora" |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` | Without an Intercom key, the support chat service is never contacted |
| `.gitignore` | Ignores the demo login file |

## Files that are new

- `README-AGORA.md`, `AGORA-CHANGES.md`
- `agora/setup-mac.sh`, `agora/start.sh`, `agora/make-env.mjs`
- `apps/backend/agora/meeting-room.html`
- `apps/backend/api/controllers/MeetingController.js`
- `apps/backend/api/models/MeetingSession.js`, `MeetingParticipant.js`, `MeetingSegment.js`
- `apps/backend/api/services/Transcription.js`, `MeetingMinutes.js`
- `apps/backend/lib/agora/mailer.js`
- `apps/backend/migrations/20261011220000_add_agora_meetings.js`
- `apps/backend/scripts/agora-demo.js`
- `apps/backend/test/unit/agora/agora.test.js`
