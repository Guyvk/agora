# What Agora changed in Hylo

Agora is a modified copy of [Hylo](https://github.com/Hylozoic/hylo), which is published under the Apache 2.0 licence. This file lists every Hylo file that Agora changed, as that licence asks. It is kept up to date with each change.

Started from Hylo's `dev` branch at commit `58f7666` (10 October 2026).

## Hylo files that were changed

| File | What changed |
| --- | --- |
| `CLAUDE.md` | One line at the top: in the cloud, read `AGORA-CLOUD.md` first |
| `apps/backend/api/services/Email.js` | Uses Agora's own email sender when no SendWithUs key is set |
| `apps/backend/api/models/post/createPost.js` | A new event without a video call link gets its meeting room as its link |
| `apps/backend/api/models/post/updatePost.js` | An event whose video call link is cleared gets its meeting room back |
| `apps/backend/config/routes.js` | Added the addresses of the meeting room, the circle Files pages (with adding files and folders) and the Contacts page |
| `apps/backend/config/policies.js` | Added who may use the meeting room, the circle Files pages and the Contacts page |
| `apps/backend/config/env/production.js` | Live updates (sockets) also accept the addresses in CORS_ALLOWED_ORIGINS, such as Agora's own domain |
| `apps/backend/knexfile.js` | The number of database connections per program can be set with `DB_POOL_MIN` and `DB_POOL_MAX`, for a small server whose database allows only a few connections. Without them nothing changes |
| `apps/backend/api/services/Websockets.js` | Fixed an error on shutdown. This one is worth offering back to Hylo |
| `apps/backend/cron.js` | Ends meetings that have gone quiet, so their minutes get written |
| `apps/backend/migrations/schema.sql` | Added the three meeting tables, the three contact tables and the table that links circles to their Drive folders, with their links deferrable like Hylo's own |
| `apps/backend/.env.example` | Added Agora's settings (including where uploads are kept) |
| `apps/backend/package.json` | Told the style checker about the new model and service names |
| `apps/web/.env.example` | `PROXY_HOST` is empty by default |
| `apps/web/index.html` | Browser title says Agora. The loading screen shows the 7 Billion Presidents mark and the word Agora instead of the Hylo mark |
| `apps/web/public/locales/en.json` | English texts say Agora where they said Hylo, the word "Contacts", and the message when a group cannot be deleted |
| `apps/web/public/locales/de.json`, `es.json`, `fr.json`, `hi.json`, `pt.json` | The word "Contacts" and the message when a group cannot be deleted, in each language |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.js` | Events show a link to their Agora meeting room, and do not repeat it as a bare video call link |
| `apps/web/src/server/proxy.js` | Without a landing site, visitors who are not logged in go to the login page |
| `apps/web/src/routes/**` (11 files) | Browser tab titles end in "Agora" |
| `apps/web/src/routes/AuthLayoutRouter/components/Drawer/Drawer.js` | No Public section (it only led to The Commons) while The Commons is off |
| `apps/web/src/routes/GroupSettings/PrivacySettingsTab/PrivacySettingsTab.jsx` | No "Add my group into the commons" box while The Commons is off |
| `apps/web/src/routes/CreateGroup/CreateGroupForm.jsx` | Same box hidden when creating a group |
| `apps/web/src/components/PublicToggle/PublicToggle.js` | The public post text does not mention The Commons while it is off |
| `apps/web/src/tours/postEditorTour.js` | The public posts tip does not mention The Commons while it is off. One new text in every language |
| `apps/web/src/components/CookiePreferencesPanel/CookiePreferencesPanel.js` | The cookie notice names no tracking or support service and has no switches (Agora has neither) |
| `apps/web/src/routes/NonAuthLayoutRouter/NonAuthLayoutRouter.js` | The login pages show the 7BP mark instead of Hylo's logo |
| `apps/web/src/routes/NonAuthLayoutRouter/Login/Login.js` | No "Continue with Google" button |
| `apps/web/public/locales/*.json (cookie notice)` | Two new texts, the cookie notice sentence and "Got it", in every language |
| `apps/web/src/routes/GroupSettings/GroupSettings.js` | Hands the result of deleting a group back to the Delete tab |
| `apps/web/src/routes/GroupSettings/DeleteSettingsTab/DeleteSettingsTab.js` | Says when a group could not be deleted, instead of doing nothing |
| `apps/web/src/routes/GroupSettings/DeleteSettingsTab/DeleteSettingsTab.test.js` | Checks that message |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` | Without an Intercom key, the support chat service is never contacted. While The Commons is off, its pages go to My Home. The Contacts page at `/contacts` |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` | No Commons button while The Commons is off. A Contacts button, with the number of my follow-ups that are due |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.test.js` | Checks that the Commons button is gone and the Contacts button is there |
| `apps/web/src/routes/AuthLayoutRouter/components/TopNav/TopNav.jsx` | No Commons tab while The Commons is off |
| `apps/backend/test/setup/core.js` | Tests keep their background jobs in their own queue (`q-test`), so the worker of an Agora running on the same computer never runs them. Uploads made by tests go to a temporary folder |
| `apps/backend/lib/uploader/storage.js` | Without Amazon S3 (no bucket or no key), uploads, calendar files and deletions go to Agora's own disk (`lib/agora/diskUploads.js`) |
| `apps/backend/api/models/Group.js`, `apps/backend/api/models/User.js` | The address of a circle's or person's calendar file points at Agora's own disk when S3 is not used |
| `apps/backend/config/http.js` | Serves uploads kept on Agora's own disk at `/noo/uploads/...` |
| `apps/backend/api/controllers/UploadController.js` | A file over the 10 MB limit is refused, instead of being stored cut off |
| `apps/backend/lib/uploader/validation.js` | An upload's id may only be letters, digits, `_` and `-`, because it becomes part of the file's path |
| `apps/backend/lib/uploader/index.js` | Profile pictures and banners must really be pictures |
| `apps/backend/test/unit/controllers/UploadController.test.js` | Its text file sent as a profile picture is now refused, and the test checks that |
| `apps/backend/lib/uploader/index.test.js` | The broken-upload test sends an attachment instead of a banner, since a banner must be a picture |
| `apps/backend/package.json`, `yarn.lock` | `send` (the file sender Sails already uses, same version) is named as a building block of the server |
| `apps/backend/lib/uploader/storage.test.js`, `apps/backend/test/unit/services/AssetManagement.test.js` | Set up a pretend S3 where they test S3, because without one files now go to disk. `storage.test.js` also puts the real storage module back afterwards, so later tests are not thrown off |
| `apps/web/src/components/UploadAttachmentButton/UploadAttachmentButton.js` | Without a Filestack key, the browser's own file picker opens and the file goes straight to Agora's server |
| `apps/web/public/locales/*.json (uploads)` | Three new texts, a file that is too big, an upload that failed and the picture formats that work, in every language |
| `.gitignore` | Ignores the demo login file, the uploads folder on a Mac, the build plan and the local notes for Claude |
| `package.json` | Skips building the old picture tool (sharp 0.32.6) of Hylo's first phone app. It cannot be built with Node 24 on a Mac, and Agora does not use that app. JSON allows no comments, so this line is the only note |

## Files that are new

- `README-AGORA.md`, `AGORA-CHANGES.md`
- `agora/setup-mac.sh`, `agora/setup-cloud.sh`, `AGORA-CLOUD.md`, `agora/start.sh`, `agora/tools.sh`, `agora/make-env.mjs`
- `agora/vps/setup-server.sh`, `agora/vps/server-env.mjs`, `agora/vps/update.sh`, `agora/vps/backup.sh` (the server at Infomaniak)
- `agora/google-drive-login.mjs`
- `apps/backend/scripts/agora-init-db.js`, `apps/backend/scripts/agora-drive-link.js`
- `apps/backend/migrations/20261017120000_add_agora_drive_folders.js`
- `apps/backend/test/unit/agora/driveUpload.test.js`
- `apps/backend/agora/meeting-room.html`, `apps/backend/agora/files.html`
- `apps/backend/api/controllers/MeetingController.js`, `apps/backend/api/controllers/AgoraFilesController.js`, `apps/backend/api/controllers/AgoraContactsController.js`
- `apps/backend/api/models/MeetingSession.js`, `MeetingParticipant.js`, `MeetingSegment.js`
- `apps/backend/api/services/Transcription.js`, `MeetingMinutes.js`
- `apps/web/src/agora/commonsMentions.test.js`
- `apps/backend/lib/agora/mailer.js`, `apps/backend/lib/agora/meetingLink.js`, `apps/backend/lib/agora/drive.js`, `apps/backend/lib/agora/driveLinks.js`, `apps/backend/lib/agora/contacts.js`
- `apps/web/src/agora/AgoraLogo.js`, `AgoraCookieNotice.js`, `AgoraCookieNotice.test.js`
- `apps/backend/migrations/20261011220000_add_agora_meetings.js`
- `apps/backend/scripts/agora-demo.js`
- `apps/web/src/agora/config.js`, `apps/web/src/agora/useDueFollowUps.js`
- `apps/web/src/agora/contacts/ContactsPage.jsx`, `apps/web/src/agora/contacts/api.js`, `apps/web/src/agora/contacts/ContactsPage.test.js`
- `apps/web/public/agora-7bp-logo.png`
- `apps/backend/migrations/20261012010000_add_agora_contacts.js`, `apps/backend/migrations/20261012020000_agora_meetings_deferrable.js`
- `apps/backend/lib/agora/diskUploads.js`, `apps/backend/test/unit/agora/diskUploads.test.js`, `apps/web/src/agora/directUpload.js`, `apps/web/src/agora/directUpload.test.js` (uploads on Agora's own disk)
- `apps/backend/test/unit/agora/agora.test.js`, `apps/backend/test/unit/agora/meetingLink.test.js`, `apps/backend/test/unit/agora/drive.test.js`, `apps/backend/test/unit/agora/meetingRoom.test.js`, `apps/backend/test/unit/agora/contacts.test.js`
