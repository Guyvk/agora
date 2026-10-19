# What Agora changed in Hylo

Agora is a modified copy of [Hylo](https://github.com/Hylozoic/hylo), which is published under the Apache 2.0 licence. This file lists every Hylo file that Agora changed, as that licence asks. It is kept up to date with each change.

Started from Hylo's `dev` branch at commit `58f7666` (10 October 2026).

## Hylo files that were changed

| File | What changed |
| --- | --- |
| `CLAUDE.md` | One line at the top: in the cloud, read `AGORA-CLOUD.md` first |
| `apps/backend/api/services/Email.js` | Uses Agora's own email sender when no SendWithUs key is set |
| `apps/backend/api/models/post/createPost.js` | A new event always gets its meeting room as its video call link, whatever was sent, and a link to another video call platform is refused as its location. For an event, the step that decides who is told is no longer queued here (see `Post.js`) |
| `apps/backend/api/models/Post.js` | `processEventCreated` queues the step that decides who is told after the invitations exist, so invitees get an invitation and not only a new post notice |
| `apps/backend/test/unit/models/Post.test.js`, `apps/backend/test/unit/models/Group.test.js` | Tests for the two changes above; the calendar tests set a made-up bucket name |
| `apps/backend/api/models/post/updatePost.js` | An event keeps its meeting room as its video call link, whatever a change sends, and invitees are never told about a link that was ignored. A link to another video call platform is refused as its location |
| `apps/backend/config/routes.js` | Added the addresses of the meeting room (with guest links and the guest's room), the circle Files pages (with adding files and folders) and the Contacts page |
| `apps/backend/config/policies.js` | Added who may use the meeting room, the guest's room (no login, the guest link is checked instead), the circle Files pages and the Contacts page |
| `apps/backend/config/env/production.js` | Live updates (sockets) also accept the addresses in CORS_ALLOWED_ORIGINS, such as Agora's own domain |
| `apps/backend/knexfile.js` | The number of database connections per program can be set with `DB_POOL_MIN` and `DB_POOL_MAX`, for a small server whose database allows only a few connections. Without them nothing changes |
| `apps/backend/api/services/Websockets.js` | Fixed an error on shutdown. This one is worth offering back to Hylo |
| `apps/backend/cron.js` | Ends meetings that have gone quiet, so their minutes get written |
| `apps/backend/migrations/schema.sql` | Added the three meeting tables (a piece of speech can be by a guest), the two tables for guests in a meeting, the three contact tables, the table that links circles to their Drive folders and the playbook table, with their links deferrable like Hylo's own |
| `apps/backend/.env.example` | Added Agora's settings (including where uploads are kept). `AGORA_MEET_DOMAIN` says calls always run there |
| `apps/backend/package.json` | Told the style checker about the new model and service names |
| `apps/backend/api/graphql/makeSchema.js` | Adds the playbook's GraphQL types (from `api/graphql/agora/`) to the schema for everyone, and their answers only for logged-in people; for anyone else they answer nothing |
| `apps/web/src/routes/AuthLayoutRouter/components/ContextMenu/ContextMenu.jsx` | A Playbook line in a group's menu, above More Spaces |
| `apps/web/.env.example` | `PROXY_HOST` is empty by default |
| `apps/web/index.html` | Browser title says Agora. The loading screen shows the 7 Billion Presidents mark and the word Agora instead of the Hylo mark |
| `apps/web/public/locales/en.json` | English texts say Agora where they said Hylo, the word "Contacts", the texts of the playbook page, and the message when a group cannot be deleted |
| `apps/web/public/locales/de.json`, `es.json`, `fr.json`, `hi.json`, `pt.json` | The word "Contacts", the texts of the playbook page and the message when a group cannot be deleted, in each language |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.js` | Events show a link to their Agora meeting room, and never a video call link to another platform |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.test.js` | Checks that a link to another platform is not shown |
| `apps/web/src/components/PostEditor/PostEditor.js` | No field for a video call link on an event, and a pasted Zoom or Meet link no longer fills one in. A video call link as the location is refused with a message |
| `apps/web/src/routes/PostDetail/PostDetail.js` | "Join online" on an event only opens its own meeting room, never an older link to another platform |
| `apps/web/public/locales/*.json (meeting room only)` | The texts of the video call link field are gone, and one new text says a video call link cannot be the location, in every language (Hindi in English for now) |
| `apps/web/src/components/PostCard/EventBody/EventBody.js` | On the event's own page, the box where the event's maker and the circle's stewards make a guest link for people without an account |
| `apps/web/public/locales/*.json (guest links)` | Twelve new texts for the guest link box, in every language |
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
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` | Without an Intercom key, the support chat service is never contacted. While The Commons is off, its pages go to My Home. The Contacts page at `/contacts`. The playbook page of a group at `/groups/<group>/playbook`. The guide at `/guide`, and the welcome steps for new members above every page |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` | No Commons button while The Commons is off. A Contacts button, with the number of my follow-ups that are due. The help menu links to Agora's guide instead of Hylo's user guide, and the own menu has an Agora guide line |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.test.js` | Checks that the Commons button is gone and the Contacts button is there |
| `apps/web/src/routes/AuthLayoutRouter/components/TopNav/TopNav.jsx` | No Commons tab while The Commons is off. The help menu links to Agora's guide instead of Hylo's user guide |
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
| `apps/backend/api/graphql/mutations/user.js` | Signing up with an email address needs a valid invitation or join link when sign-up is by invitation only |
| `apps/backend/api/graphql/schema.graphql` | Signing up can carry the invitation (`invitationToken` or `accessCode`). The note on `meetingLink` says it is always the event's meeting room |
| `apps/backend/api/controllers/SessionController.js` | A first login with Google, Apple and the like makes an account only with a valid invitation when sign-up is by invitation only |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` | The address where the sign-up page asks whether sign-up is by invitation only (also listed above) |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Signup.js` | Says "Agora is by invitation" to someone without an invitation, sends the invitation along, no Google button |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Signup.store.js` | Sends the invitation along when signing up |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Signup.test.js` | Gives the page a pretend server to ask |
| `apps/web/src/routes/NonAuthLayoutRouter/util.js` | The message when a sign-up without an invitation is refused |
| `apps/web/public/locales/*.json (sign-up)` | Four new texts about signing up by invitation, in every language |
| `apps/web/src/routes/WelcomeWizardRouter/WelcomeExplore/WelcomeExplore.js`, `WelcomeExplore.test.js` | The last page of the sign-up wizard starts with a card for the Agora guide, and the test checks it |
| `apps/web/public/locales/*.json (guide)` | The texts of the guide and the welcome steps: all in English, the short ones also in the other languages |
| `apps/web/src/routes/RootRouter/RootRouter.js` | The pages `/terms` and `/privacy` (Agora's own Terms of use and Privacy notice), for everyone, logged in or not |
| `apps/web/src/routes/NonAuthLayoutRouter/NonAuthLayoutRouter.js`, `apps/web/src/routes/OAuth/OAuthLayoutRouter.js`, `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx`, `apps/web/src/routes/AuthLayoutRouter/components/TopNav/TopNav.jsx` | The Terms and Privacy links go to Agora's own `/terms` and `/privacy` instead of hylo.com (NonAuthLayoutRouter also has the 7BP mark, see above) |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Agreements/Agreements.js`, `apps/web/src/store/constants.js` | The agreement links of the sign-up page and of reporting content go to Agora's Terms of use instead of hylo.com |
| `apps/web/public/locales/en.json (terms and privacy)` | The texts of the Terms of use and the Privacy notice (drafts), "Terms of use" and "Privacy notice" as link names, and the sign-up agreement says Agora where it said Hylo |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (help) | The addresses of Help and the Help desk, for anyone logged in; each one checks who may see which request |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (admin) | The addresses of the admin area, for anyone logged in; each one checks for an Agora admin |
| `apps/backend/migrations/schema.sql` (help) | The three tables of Help and the Help desk |
| `apps/backend/package.json`, `yarn.lock` (help) | Anthropic's official library for Claude (`@anthropic-ai/sdk`), for the chat in the Help window |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` (help) | The Help button at the bottom right of every page, and the Help desk at `/help-desk` |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` (admin) | The admin area at `/admin`, with the Help desk as its tab at `/admin/help-desk`; the old `/help-desk` addresses lead there |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` (admin) | An "Admin" line in the gear menu, for Agora admins and Help desk admins only |
| `apps/web/public/locales/en.json` (help) | The texts of Help and the Help desk, in English only for now; other languages show the English |
| `apps/web/public/locales/en.json` (admin) | The texts of the admin area, in English only for now; other languages show the English |
| `.gitignore` | Ignores the demo login file, the uploads folder on a Mac, the build plan and the local notes for Claude |
| `package.json` | Skips building the old picture tool (sharp 0.32.6) of Hylo's first phone app. It cannot be built with Node 24 on a Mac, and Agora does not use that app. JSON allows no comments, so this line is the only note |

## Files that are new

- `README-AGORA.md`, `AGORA-CHANGES.md`
- `agora/setup-mac.sh`, `agora/setup-cloud.sh`, `AGORA-CLOUD.md`, `agora/start.sh`, `agora/tools.sh`, `agora/make-env.mjs`
- `agora/vps/setup-server.sh`, `agora/vps/server-env.mjs`, `agora/vps/update.sh`, `agora/vps/backup.sh` (the server at Infomaniak)
- `agora/vps/offsite-backup.sh`, `agora/vps/offsite-backup.conf.example` (an encrypted copy of the backups in object storage), `.github/workflows/agora-uptime.yml` (a warning when Agora is down)
- `agora/google-drive-login.mjs`
- `apps/backend/scripts/agora-init-db.js`, `apps/backend/scripts/agora-drive-link.js`
- `apps/backend/lib/agora/signup.js`, `apps/backend/api/controllers/AgoraSignupController.js`, `apps/backend/scripts/agora-allow-signup.js`, `apps/backend/test/unit/agora/signup.test.js`
- `apps/backend/lib/agora/stewardRoles.js`, `apps/backend/scripts/agora-steward-roles.js`, `apps/backend/test/unit/agora/stewardRoles.test.js`
- `apps/web/src/agora/signup.js`, `apps/web/src/agora/AgoraInviteOnlyNotice.js`, `apps/web/src/agora/signup.test.js`
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
- `apps/backend/migrations/20261019120000_add_agora_meeting_guests.js`, `apps/backend/lib/agora/meetingGuests.js`, `apps/backend/lib/agora/meetingRoom.js`, `apps/backend/api/controllers/MeetingGuestController.js`, `apps/backend/test/unit/agora/meetingGuests.test.js` (guests in a meeting)
- `apps/web/src/agora/meeting/GuestLinkPanel.jsx`, `apps/web/src/agora/meeting/GuestLinkPanel.test.js`
- `apps/backend/scripts/agora-demo.js`
- `apps/backend/scripts/agora-meeting-links.js` (gives older events their meeting room as their video call link)
- `apps/web/src/agora/config.js`, `apps/web/src/agora/useDueFollowUps.js`
- `apps/web/src/agora/contacts/ContactsPage.jsx`, `apps/web/src/agora/contacts/api.js`, `apps/web/src/agora/contacts/ContactsPage.test.js`
- `apps/web/public/agora-7bp-logo.png`
- `apps/backend/migrations/20261018120000_add_agora_playbook.js`, `apps/backend/api/models/AgoraPlaybookChapter.js`, `apps/backend/lib/agora/playbook.js`, `apps/backend/api/graphql/agora/playbook.graphql`, `apps/backend/api/graphql/agora/playbook.js`, `apps/backend/test/unit/agora/playbook.test.js`
- `apps/web/src/agora/guide/GuidePage.jsx`, `WelcomeSteps.jsx`, `useAgoraSeen.js`, `useMyCircle.js`, `guideUrl.js`, `GuidePage.test.js`, `WelcomeSteps.test.js` (the guide and the welcome steps)
- `apps/web/src/agora/playbook/PlaybookPage.jsx`, `apps/web/src/agora/playbook/PlaybookMenuLink.jsx`, `apps/web/src/agora/playbook/api.js`, `apps/web/src/agora/playbook/PlaybookPage.test.js`
- `apps/backend/migrations/20261012010000_add_agora_contacts.js`, `apps/backend/migrations/20261012020000_agora_meetings_deferrable.js`
- `apps/backend/lib/agora/diskUploads.js`, `apps/backend/test/unit/agora/diskUploads.test.js`, `apps/web/src/agora/directUpload.js`, `apps/web/src/agora/directUpload.test.js` (uploads on Agora's own disk)
- `apps/web/src/agora/legal/LegalPage.jsx`, `apps/web/src/agora/legal/legalTexts.js`, `apps/web/src/agora/legal/LegalPage.test.js` (the Terms of use and the Privacy notice)
- `apps/backend/migrations/20261019120000_add_agora_help_requests.js`, `apps/backend/lib/agora/help.js`, `apps/backend/lib/agora/helpClaude.js`, `apps/backend/lib/agora/helpGuide.md`, `apps/backend/api/controllers/AgoraHelpController.js`, `apps/backend/test/unit/agora/help.test.js` (Help and the Help desk; the reply email text is in `lib/agora/mailer.js`)
- `apps/backend/lib/agora/admins.js` (who is an Agora admin or Help desk admin), `apps/backend/lib/agora/adminDashboard.js`, `apps/backend/lib/agora/allowSignup.js` (the code of `scripts/agora-allow-signup.js`, also used by the admin area), `apps/backend/api/controllers/AgoraAdminController.js`, `apps/backend/test/unit/agora/adminDashboard.test.js` (the admin area; `lib/agora/help.js` asks `admins.js` who runs the Help desk, and `agora/vps/offsite-backup.sh` leaves a mark after each copy that worked)
- `apps/web/src/agora/admin/AdminPage.jsx`, `apps/web/src/agora/admin/api.js`, `apps/web/src/agora/admin/AdminPage.test.js` (the admin area page; the Help desk page `HelpDeskPage.jsx` is now its Help desk tab)
- `apps/web/src/agora/help/HelpWindow.jsx`, `apps/web/src/agora/help/HelpDeskPage.jsx`, `apps/web/src/agora/help/api.js`, `apps/web/src/agora/help/HelpWindow.test.js`, `apps/web/src/agora/help/HelpDeskPage.test.js`
- `apps/backend/test/unit/agora/agora.test.js`, `apps/backend/test/unit/agora/meetingLink.test.js`, `apps/backend/test/unit/agora/drive.test.js`, `apps/backend/test/unit/agora/meetingRoom.test.js`, `apps/backend/test/unit/agora/contacts.test.js`
