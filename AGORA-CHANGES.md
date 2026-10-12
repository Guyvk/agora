# What Agora changed in Hylo

Agora is a modified copy of [Hylo](https://github.com/Hylozoic/hylo), which is published under the Apache 2.0 licence. This file lists every Hylo file that Agora changed, as that licence asks. It is kept up to date with each change.

Started from Hylo's `dev` branch at commit `58f7666` (10 October 2026).

## Hylo files that were changed

| File | What changed |
| --- | --- |
| `apps/backend/api/services/Email.js` | Uses Agora's own email sender when no SendWithUs key is set |
| `apps/backend/api/models/post/createPost.js` | A new event without a video call link gets its meeting room as its link |
| `apps/backend/api/models/post/updatePost.js` | An event whose video call link is cleared gets its meeting room back |
| `apps/backend/config/routes.js` | Added the addresses of the meeting room, the circle Files pages and the Contacts page |
| `apps/backend/config/policies.js` | Added who may use the meeting room, the circle Files pages and the Contacts page |
| `apps/backend/api/services/Websockets.js` | Fixed an error on shutdown. This one is worth offering back to Hylo |
| `apps/backend/cron.js` | Ends meetings that have gone quiet, so their minutes get written |
| `apps/backend/migrations/schema.sql` | Added the three meeting tables and the three contact tables, with their links deferrable like Hylo's own |
| `apps/backend/.env.example` | Added Agora's settings |
| `apps/backend/package.json` | Told the style checker about the new model and service names |
| `apps/web/.env.example` | `PROXY_HOST` is empty by default |
| `apps/web/index.html` | Browser title says Agora |
| `apps/web/public/locales/en.json` | English texts say Agora where they said Hylo, and the word "Contacts" |
| `apps/web/public/locales/de.json`, `es.json`, `fr.json`, `hi.json`, `pt.json` | The word "Contacts" in each language |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.js` | Events show a link to their Agora meeting room, and do not repeat it as a bare video call link |
| `apps/web/src/server/proxy.js` | Without a landing site, visitors who are not logged in go to the login page |
| `apps/web/src/routes/**` (11 files) | Browser tab titles end in "Agora" |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` | Without an Intercom key, the support chat service is never contacted. While The Commons is off, its pages go to My Home |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` | No Commons button while The Commons is off. A Contacts button, with the number of my follow-ups that are due |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.test.js` | Checks that the Commons button is gone and the Contacts button is there |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNavItem.jsx` | A button that points to a page the server makes itself (under `/noo/`) loads it as a whole page |
| `apps/web/src/routes/AuthLayoutRouter/components/TopNav/TopNav.jsx` | No Commons tab while The Commons is off |
| `apps/backend/test/setup/core.js` | Tests keep their background jobs in their own queue (`q-test`), so the worker of an Agora running on the same computer never runs them |
| `.gitignore` | Ignores the demo login file, the build plan and the local notes for Claude |
| `package.json` | Skips building the old picture tool (sharp 0.32.6) of Hylo's first phone app. It cannot be built with Node 24 on a Mac, and Agora does not use that app. JSON allows no comments, so this line is the only note |

## Files that are new

- `README-AGORA.md`, `AGORA-CHANGES.md`
- `agora/setup-mac.sh`, `agora/start.sh`, `agora/tools.sh`, `agora/make-env.mjs`
- `apps/backend/agora/meeting-room.html`, `apps/backend/agora/files.html`, `apps/backend/agora/contacts.html`
- `apps/backend/api/controllers/MeetingController.js`, `apps/backend/api/controllers/AgoraFilesController.js`, `apps/backend/api/controllers/AgoraContactsController.js`
- `apps/backend/api/models/MeetingSession.js`, `MeetingParticipant.js`, `MeetingSegment.js`
- `apps/backend/api/services/Transcription.js`, `MeetingMinutes.js`
- `apps/backend/lib/agora/mailer.js`, `apps/backend/lib/agora/meetingLink.js`, `apps/backend/lib/agora/drive.js`, `apps/backend/lib/agora/contacts.js`
- `apps/backend/migrations/20261011220000_add_agora_meetings.js`
- `apps/backend/scripts/agora-demo.js`
- `apps/web/src/agora/config.js`, `apps/web/src/agora/useDueFollowUps.js`
- `apps/backend/migrations/20261012010000_add_agora_contacts.js`, `apps/backend/migrations/20261012020000_agora_meetings_deferrable.js`
- `apps/backend/test/unit/agora/agora.test.js`, `apps/backend/test/unit/agora/meetingLink.test.js`, `apps/backend/test/unit/agora/drive.test.js`, `apps/backend/test/unit/agora/meetingRoom.test.js`, `apps/backend/test/unit/agora/contacts.test.js`
