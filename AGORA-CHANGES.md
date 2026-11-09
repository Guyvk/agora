# What Agora changed in Hylo

Agora is a modified copy of [Hylo](https://github.com/Hylozoic/hylo), which is published under the Apache 2.0 licence. This file lists every Hylo file that Agora changed, as that licence asks. It is kept up to date with each change.

Started from Hylo's `dev` branch at commit `58f7666` (10 October 2026).

## Hylo files that were changed

| File | What changed |
| --- | --- |
| `CLAUDE.md` | Loads Agora's `AGENTS.md` at the top (its rules win). Hylo's GitHub, ticket-to-PR and autonomous issue workflow sections are replaced by a short Agora note; commands, testing and screenshot tips and conventions are kept |
| `.cursorrules` | One line at the top: read `AGENTS.md` first |
| `.claude/agents/hylo-worker.md` | Removed: it picked up issues on Hylo's GitHub and opened pull requests there |
| `apps/backend/api/services/Email.js` | Uses Agora's own email sender when no SendWithUs key is set (kept next to Hylo's rule that tests never send email) |
| `apps/backend/api/models/post/createPost.js` | A new event always gets its meeting room as its video call link, whatever was sent, and a link to another video call platform is refused as its location. For an event, the step that decides who is told is no longer queued here (see `Post.js`) |
| `apps/backend/api/models/Post.js` | `processEventCreated` queues the step that decides who is told after the invitations exist, so invitees get an invitation and not only a new post notice. `addFollowers` compares user ids as strings, so someone who already follows a post (passed as a number, e.g. from a script or an email reply) is no longer added twice, which made their comment fail halfway |
| `apps/backend/test/unit/models/Post.test.js`, `apps/backend/test/unit/models/Group.test.js` | Tests for the two changes above; the calendar tests set a made-up bucket name |
| `apps/backend/api/models/post/updatePost.js` | An event keeps its meeting room as its video call link, whatever a change sends, and invitees are never told about a link that was ignored. A link to another video call platform is refused as its location |
| `apps/backend/config/routes.js` | Added the addresses of the meeting room (with guest links, the guest's room, the meeting chat, "still here", leaving the call and the end screen), the circle Files pages (with adding files and folders) and the Contacts page |
| `apps/backend/config/policies.js` | Added who may use the meeting room, the guest's room (no login, the guest link is checked instead; a guest may also use the chat and the end screen of their own meeting), the circle Files pages and the Contacts page |
| `apps/backend/config/env/production.js` | Live updates (sockets) also accept the addresses in CORS_ALLOWED_ORIGINS, such as Agora's own domain |
| `apps/backend/knexfile.js` | The number of database connections per program can be set with `DB_POOL_MIN` and `DB_POOL_MAX`, for a small server whose database allows only a few connections. Without them nothing changes |
| `apps/backend/api/services/Websockets.js` | Fixed an error on shutdown. This one is worth offering back to Hylo |
| `apps/backend/cron.js` | Every 10 minutes also runs the 7BP Home job, which never throws (`lib/agora/mainGroup.js`). Ends meetings everybody has left (or that run 2 hours past the event), so their minutes get written. Every hour, makes the Agora admins (`AGORA_ADMINS`) members and Administrator of every circle and space where that is missing, also where they left or were removed |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` | One new route, `GET /noo/agora/this-week`, for anyone logged in (This week in 7BP) |
| `apps/web/src/routes/GroupWelcomePage/GroupWelcomePage.jsx` | Shows the "This week in 7BP" block above the welcome text; it shows nothing unless the circle is the main circle |
| `apps/web/public/locales/*.json` | The words of "This week in 7BP" and one guide sentence, in English in every language file |
| `apps/web/src/agora/guide/guideParts.json`, `apps/backend/lib/agora/helpGuide.md` | One sentence on the 7BP Home and its "This week" block in the guide (and so for Claude in Help) |
| `apps/backend/migrations/schema.sql` | Added the three meeting tables (a piece of speech can be by a guest; "still here" and "left" times per person), the meeting chat table, the two tables for guests in a meeting, the three contact tables, the table that links circles to their Drive folders and the playbook table and the table of Google document links in the kDrive Files page, with their links deferrable like Hylo's own |
| `apps/backend/.env.example` | Added Agora's settings (including where uploads are kept). `AGORA_MEET_DOMAIN` says calls always run there |
| `apps/backend/package.json` | Told the style checker about the new model and service names |
| `apps/backend/api/graphql/makeSchema.js` | Adds the playbook's GraphQL types (from `api/graphql/agora/`) to the schema for everyone, and their answers only for logged-in people; for anyone else they answer nothing |
| `apps/web/src/routes/AuthLayoutRouter/components/ContextMenu/ContextMenu.jsx` | A Playbook line in a group's menu, above More Spaces. A Files line above it, for members of the circle, or of the space when its menu is open (it opens the Files page inside the app, `/groups/<group>/files`, or the space's own under its circle) |
| `apps/web/.env.example` | `PROXY_HOST` is empty by default |
| `apps/web/index.html` | Browser title says Agora. The loading screen shows the 7 Billion Presidents mark and the word Agora instead of the Hylo mark |
| `apps/web/public/locales/en.json` | English texts say Agora where they said Hylo, the word "Contacts", the texts of the playbook page, and the message when a group cannot be deleted |
| `apps/web/public/locales/de.json`, `es.json`, `fr.json`, `hi.json`, `pt.json` | The word "Contacts", the texts of the playbook page and the message when a group cannot be deleted, in each language |
| `apps/web/public/locales/*.json` | The words of the new Contacts table and side panel (views, columns, Propose dropdown, activity), in each language. The Contacts page is now a table with a side panel; its list also returns the date of the latest note (`last_contact_at`) |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.js` | Events show a link to their Agora meeting room, and never a video call link to another platform; the link has a video icon, reads "Video meeting in Agora (with minutes)" and opens in the same tab |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.test.js` | Checks that a link to another platform is not shown |
| `apps/web/src/components/PostEditor/PostEditor.js` | No field for a video call link on an event, and a pasted Zoom or Meet link no longer fills one in. A video call link as the location is refused with a message. A one-line hint says every meeting gets its own video room |
| `apps/web/src/routes/PostDetail/PostDetail.js` | "Join online" on an event only opens its own meeting room, never an older link to another platform; it opens in the same tab |
| `apps/web/src/components/TextInput/TextInput.js`, `TextInput.test.js` | The X in a field cleared nothing in forms that pick the field by its name (sign-up password fields): it now sends the field's own name. Hylo made the same fix itself (3 Nov 2026 sync), so the file is Hylo's again except for the test |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/FinishRegistration/FinishRegistration.test.js` | Test that the X in a password field clears only that field |
| `apps/web/src/components/PostEditor/PostEditor.test.js`, `apps/web/src/routes/PostDetail/PostDetail.test.js` | Tests for the video meeting hint and for the meeting room opening in the same tab |
| `apps/web/src/agora/guide/guideParts.json`, `apps/web/src/agora/help/HelpWindow.test.js` | The guide names the meeting room link by its new name |
| `apps/web/public/locales/*.json (video meeting)` | Two new texts in every language: the hint on the event form and the name of the meeting room link ("Video meeting in Agora (with minutes)") |
| `apps/web/public/locales/*.json (meeting room only)` | The texts of the video call link field are gone, and one new text says a video call link cannot be the location, in every language (Hindi in English for now) |
| `apps/web/src/components/PostCard/EventBody/EventBody.js` | On the event's own page, the box where the event's maker and the circle's stewards make a guest link for people without an account |
| `apps/web/src/components/PostCard/EventBody/EventBody.js`, `EventBody.test.js`, `apps/web/src/components/PostCard/PostCard.jsx`, `apps/web/src/routes/PostDetail/PostDetail.js`, `apps/web/public/locales/*.json` | An event whose end (or start, when it has no end) is in the past shows "This event has passed" next to its date, on the card and on the event page. The event's maker and the circle's administrators also get a "Set a new date" button that opens the post editor in the same page. The words are in all six language files |
| `apps/web/public/locales/*.json (guest links)` | Twelve new texts for the guest link box, in every language |
| `apps/web/src/server/proxy.js` | Without a landing site, visitors who are not logged in go to the login page |
| `apps/web/src/routes/**` (11 files) | Browser tab titles end in "Agora" |
| `apps/web/src/routes/AuthLayoutRouter/components/Drawer/Drawer.js` | No Public section (it only led to The Commons) while The Commons is off |
| `apps/web/src/routes/GroupSettings/PrivacySettingsTab/PrivacySettingsTab.jsx` | No "Add my group into the commons" box while The Commons is off |
| `apps/web/src/routes/CreateGroup/CreateGroupForm.jsx` | Same box hidden when creating a group |
| `apps/web/src/components/PublicToggle/PublicToggle.js` | The public post text does not mention The Commons while it is off |
| `apps/web/src/tours/postEditorTour.js` | The public posts tip does not mention The Commons while it is off. One new text in every language |
| `apps/web/src/components/CookiePreferencesPanel/CookiePreferencesPanel.js` | The cookie notice names no tracking or support service and has no switches (Agora has neither) |
| `apps/web/src/routes/SpaceContent/SpaceContent.js` | The Files page of a space inside the app, at `/groups/<circle>/spaces/<space>/files` |
| `apps/web/src/routes/NonAuthLayoutRouter/NonAuthLayoutRouter.js` | The login pages show the 7BP mark instead of Hylo's logo |
| `apps/web/src/routes/NonAuthLayoutRouter/Login/Login.js` | No "Continue with Google" button |
| `apps/web/public/locales/*.json (cookie notice)` | Two new texts, the cookie notice sentence and "Got it", in every language |
| `apps/web/src/routes/GroupSettings/GroupSettings.js` | Hands the result of deleting a group back to the Delete tab |
| `apps/web/src/routes/GroupSettings/DeleteSettingsTab/DeleteSettingsTab.js` | Says when a group could not be deleted, instead of doing nothing |
| `apps/web/src/routes/GroupSettings/DeleteSettingsTab/DeleteSettingsTab.test.js` | Checks that message |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` | Without an Intercom key, the support chat service is never contacted. While The Commons is off, its pages go to My Home. The Contacts page at `/contacts`. The playbook page of a group at `/groups/<group>/playbook`. The Files page of a group at `/groups/<group>/files`. The guide at `/guide`, and the welcome steps for new members above every page |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` | No Commons button while The Commons is off. A Contacts button, with the number of my follow-ups that are due. The help menu links to Agora's guide instead of Hylo's user guide, and the own menu has an Agora guide line |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.test.js` | Checks that the Commons button is gone and the Contacts button is there |
| `apps/web/src/routes/AuthLayoutRouter/components/TopNav/TopNav.jsx` | No Commons tab while The Commons is off. The help menu links to Agora's guide instead of Hylo's user guide |
| `apps/backend/test/setup/core.js` | Tests keep their background jobs in their own queue (`q-test`), so the worker of an Agora running on the same computer never runs them. Uploads made by tests go to a temporary folder. Tests start without `AGORA_ADMINS`, so a setting in `.env` never joins the circles tests make |
| `apps/backend/lib/uploader/storage.js` | Without Amazon S3 (no bucket or no key), uploads, calendar files and deletions go to Agora's own disk (`lib/agora/diskUploads.js`) |
| `apps/backend/api/models/Group.js`, `apps/backend/api/models/User.js` | The address of a circle's or person's calendar file points at Agora's own disk when S3 is not used |
| `apps/backend/config/http.js` | Serves uploads kept on Agora's own disk at `/noo/uploads/...` |
| `apps/backend/api/controllers/UploadController.js` | A file over the 10 MB limit is refused, instead of being stored cut off |
| `apps/backend/lib/uploader/validation.js` | An upload's id may only be letters, digits, `_` and `-`, because it becomes part of the file's path |
| `apps/backend/lib/uploader/index.js` | Profile pictures and banners must really be pictures |
| `apps/backend/test/unit/controllers/UploadController.test.js` | Its text file sent as a profile picture is now refused, and the test checks that (Hylo's version of the test mocks S3; that part is kept) |
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
| `apps/web/public/locales/*.json (guide)` | The texts of the guide and the welcome steps, and the words of the Guide in the Help window: all in English, the short ones also in the other languages. The server reads the guide's English texts from `en.json` for Claude in Help |
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
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` (7BP Home look) | The 7BP Home is first in the left bar with the 7BP mark, its active child circles right under it, the two together on one tinted panel, all tiles the normal size; other circles after. Pins and dragging order only the other circles (and pinned spaces, which Hylo added to the bar on 3 Nov 2026, are treated like other circles). My Home shows a house on a dark tile when there is no profile picture |
| `apps/web/src/components/GroupMenuHeader/GroupMenuHeader.jsx` (7BP Home look) | A "7BP Home" pill, tint and strip on the main circle's header; a "Part of 7BP" link on its active child circles |
| `apps/web/src/routes/GroupWelcomePage/GroupWelcomePage.jsx` (7BP Home look) | One line: the "Every circle in 7BP" cards (only in the main circle) |
| `apps/backend/api/graphql/makeSchema.js` (7BP Home look) | Adds the `agoraMainCircle` query for logged-in people |
| `apps/web/public/locales/en.json` (help) | The texts of Help and the Help desk, in English only for now; other languages show the English |
| `apps/backend/lib/i18n/en.js`, `de.js`, `es.js`, `fr.js`, `hi.js`, `pt.js` | The default invitation subject and text say Agora instead of Hylo ("Guy invites you to Governance in Agora", "Hi! I'm inviting you to join Governance in Agora, 7 Billion Presidents' own online home."), in every language |
| `apps/backend/api/graphql/mutations/invitation.js` | Gives the inviter's name to the invitation subject |
| `apps/backend/api/models/Invitation.js` | An email invitation can only be used by the account with the address it was sent to, while sign-up is by invitation only (`lib/agora/signup.js`) |
| `apps/backend/api/graphql/mutations/group.js`, `apps/backend/api/graphql/mutations/spaces.js` | Joining a circle or space with an email invitation sent to another address counts as joining without an invitation, and does not use it up |
| `apps/backend/api/models/Group.js` (`create`), `apps/backend/api/graphql/mutations/spaces.js` (`createSpace`) | After a circle or space is made, the Agora admins (`AGORA_ADMINS`) become members of it and Administrator (of the circle; a space uses the roles of its circle). This changes who administers circles. It never makes the creation fail |
| `apps/web/src/routes/JoinGroup/JoinGroup.js` | Someone logged in who opens an invitation email sent to another address gets a page that says so, with "Log out and continue", instead of the circle |
| `apps/backend/api/graphql/mutations/user.js`, `apps/backend/api/controllers/SessionController.js`, `apps/backend/api/graphql/schema.graphql`, `apps/web/src/routes/JoinGroup/JoinGroup.js` (+ test), `apps/web/src/store/actions/checkInvitation.js` (joining on sign-up) | Someone who signs up from a circle's join link or invitation email becomes a member of that circle as soon as the account is finished, also when the email code is opened in another browser; someone logged in who opens one is joined at once and lands in the circle (`lib/agora/signup.js`). The invitation check also gives the parent circle's id of a space. A circle with agreements or join questions shows its About page first instead of joining at once |
| `apps/backend/api/graphql/makeSchema.js` (logged-out reading) | Without logging in nothing can be read: the public queries for circles, posts and people give nothing. Only the circle of a valid join link or invitation gives its name and address, so the sign-up page can say where the person is going; every other field of the circle is empty |
| `apps/backend/config/session.js` (uploads need the session) | Sails skips the session for paths that look like a file, so uploads at /noo/uploads keep it; without this every picture answered 401 also to logged-in people (`test/unit/agora/uploadsSession.test.js`) |
| `apps/backend/api/services/GetImageSize.js`, `apps/backend/api/services/AssetManagement.js` (own uploads from disk) | The server reads pictures uploaded to Agora's own disk from that disk when it measures them or makes a small copy. Fetching them over the web was refused, because uploads are only for people who are logged in, so every post with a picture failed |
| `apps/backend/config/policies.js`, `apps/backend/api/controllers/MurmurationsController.js`, `apps/backend/config/http.js` (logged-out reading) | A circle's Murmurations profile needs a login, and an unknown circle gives not found instead of an error. The uploads (pictures and files) are served after the session is read, and only to someone logged in (`lib/agora/diskUploads.js`). A first Apple or Google login of an unfinished account also joins the circle of its kept invitation (`SessionController.js`) |
| `apps/web/src/routes/GroupDetail/GroupDetail.js` (Join button on top) | On the page of a circle you are not a member of, the Join section is above the description instead of at the bottom. Since the 3 Nov 2026 sync it also holds Hylo's panel for someone who left a paid circle and may rejoin, and passes Hylo's `grantAccess` to the Join section. The test for this lives in `GroupDetailJoinAtTop.test.js`, because Hylo's own `GroupDetail.test.js` is a different file |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Signup.js` (invitation address) | Coming from an invitation email, the address it was sent to is filled in and cannot be changed |
| `apps/web/public/locales/*.json (invitations)` | Hylo's old default invitation text says Agora, and six new texts for the page above and the sign-up note, in every language |
| `apps/web/public/locales/en.json` (admin) | The texts of the admin area, in English only for now; other languages show the English |
| `apps/backend/api/models/post/createPost.js` (library) | A new resource post queues the job that reads the text of its attachments for the circle library, unless the library made it |
| `apps/backend/cron.js` (library) | Once a day, files sent to a circle library but never added to an item are removed |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (library) | The addresses of the circle library, for anyone logged in; each one checks that the person is a member of the circle |
| `apps/backend/migrations/schema.sql` (library) | The three tables of the circle library: items, files, and the text read from files (`agora_file_texts`) |
| `apps/backend/package.json` (library) | Told the style checker about the `AgoraLibrary` service |
| `apps/backend/.env.example` (library) | The library's settings: where files are kept (disk or S3 object storage), the S3 settings, the size limits |
| `apps/web/public/locales/en.json` (library) | The texts of the circle library, in English only for now; other languages show the English |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` (library) | A circle's Resources tab shows the circle library instead of Hylo's list of resources |
| `apps/backend/api/models/post/createPost.js` (ask) | A new post is queued for the Ask index of its circles |
| `apps/backend/api/models/Post.js` (ask) | After an edit, a new comment or a vote, the post is queued for the Ask index again; a removed post leaves it |
| `apps/backend/api/models/comment/updateComment.js`, `apps/backend/api/models/comment/deleteComment.js` | A changed or removed comment is queued for the Ask index |
| `apps/backend/cron.js` (ask) | The Ask index catches up every 10 minutes, and the anonymised themes of private messages are made once a day |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (ask) | The addresses of a circle's Ask tab, for anyone logged in; each one checks membership of the circle |
| `apps/backend/migrations/schema.sql` (ask) | The five tables of Ask: the knowledge index, questions, usage, bookkeeping and private themes |
| `apps/backend/.env.example` (ask) | The settings of Ask |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` (ask) | The Ask tab of a circle at `/groups/<circle>/ask` |
| `apps/web/src/routes/AuthLayoutRouter/components/ContextMenu/ContextMenu.jsx` (ask) | An Ask line in a circle's menu, next to Playbook, when Ask is on |
| `apps/web/public/locales/en.json` (ask) | The texts of the Ask tab, and a part about Ask in the Privacy notice, in English only for now; other languages show the English |
| `apps/backend/config/routes.js` (admin roles) | The address where an Agora admin changes someone's role on the Accounts tab; it checks for an Agora admin itself |
| `apps/backend/migrations/schema.sql` (admin roles) | The table of Agora-wide roles (`agora_roles`) and the log of their changes (`agora_role_changes`) |
| `apps/backend/.env.example` (admin roles) | `AGORA_ADMINS` says roles can also be given in the admin area, and that the setting is the fallback |
| `apps/web/public/locales/en.json` (admin roles) | The texts of the role control on the Accounts tab and of a role change in the Activity log, in English only for now |
| `apps/web/src/routes/ChatRoom/ChatRoom.js` | The chat list is Agora's own `AgoraMessageList` instead of Hylo's paid `@virtuoso.dev/message-list`, which needs a licence key and without one showed only a red licence notice and no messages. Same props, no licence wrapper |
| `apps/web/src/routes/ChatRoom/ChatRoom.module.scss` | The phone rule for the chat scroller points at the new list |
| `apps/web/src/routes/ChatRoom/ChatRoom.test.js` | No longer pretends the paid list is there |
| `apps/web/package.json`, `yarn.lock` (chat) | `@virtuoso.dev/message-list` (and its helper `@virtuoso.dev/gurx`) removed |
| `apps/web/vite.config.js` | A comment only: the old note about the Virtuoso licence watermark no longer applies |
| `apps/web/src/routes/NonAuthLayoutRouter/Login/Login.js` | A real form: email marked as username, password as current password, the button submits it, so password managers fill and save the login |
| `apps/web/src/routes/OAuth/Login/Login.js` | Same username and current-password marks |
| `apps/web/src/routes/NonAuthLayoutRouter/PasswordReset/PasswordReset.js` | A real form, the email field marked as username |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Signup.js` | The email field is marked as username (it said "no autofill") |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/FinishRegistration/FinishRegistration.js` | The "choose a password" step is a real form with the email as a hidden username and both password fields marked as new password, so password managers offer to save it |
| `apps/web/src/routes/UserSettings/AccountSettingsTab/AccountSettingsTab.js` | Email and new password fields are a real form (username, new-password); after a password is saved, a same-page history step tells the browser it worked, so it offers to save the new password. The "Set a new password" link from the reset email lands here |
| `apps/backend/api/models/post/createPost.js` (meetings and events) | A new event post is a Meeting or an Event, and "for all of 7BP" is checked (`lib/agora/eventKinds.js`). When asked, everyone gets a calendar invitation |
| `apps/backend/api/models/post/updatePost.js` (meetings and events) | A change keeps or switches the kind, and only stewards of the main 7BP circle may switch "for all of 7BP". Only the post's author, or someone with Manage Content or Administration in one of its circles, may change a post at all (`lib/agora/postEditing.js`; Hylo checked nothing) |
| `apps/backend/api/graphql/mutations/post.js` | Changing a proposal's options needs the same right as changing the post |
| `apps/backend/api/graphql/mutations/post.test.js` | Its proposal is made by the person who changes its options, as that rule now needs |
| `apps/backend/api/models/Post.js` (meetings and events) | A post for all of 7BP is visible to every logged-in member (`isVisibleToUser`), and emails know whether a post is a Meeting or an Event |
| `apps/backend/api/graphql/filters.js` | Meetings and Events for all of 7BP, with their comments and reactions, are readable by every logged-in member while one of their circles exists |
| `apps/backend/api/graphql/filters.test.js` | Its expected post query includes the clause for posts for all of 7BP |
| `apps/backend/api/graphql/makeModels.js` | A post tells its kind (`agoraKind`) and whether it is for all of 7BP (`agoraForAll`) |
| `apps/backend/api/graphql/schema.graphql` (meetings and events) | The fields `agoraKind` and `agoraForAll` on posts, and `agoraKind`, `agoraForAll`, `agoraInviteEveryone` when making or changing one |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (calendar) | The addresses of the calendar page's server part (login needed) and of the calendar feed (no login, its secret is the key) |
| `apps/backend/config/http.js` | The request log hides whatever follows `/noo/agora/calendar/` (the secret of a calendar link), except the page's own `api` calls |
| `apps/backend/lib/sentry.js` | Error reports hide the secret of a calendar link too |
| `apps/backend/migrations/schema.sql` (meetings and events) | The two new columns of posts and the table of calendar links |
| `apps/backend/.env.example` (meetings and events) | `AGORA_MAIN_GROUP_SLUG`, the main 7BP circle |
| `apps/backend/package.json` (calendar) | Told the style checker about the `AgoraCalendar` service |
| `apps/web/src/components/CreateMenu/CreateMenu.jsx` | Two choices instead of "Event": Meeting and Event |
| `apps/web/src/components/PostEditor/PostEditor.js` (meetings and events) | Choosing Meeting or Event, "for all of 7BP" for stewards of the main circle, no public switch for a Meeting |
| `apps/web/src/components/PostCard/PostHeader/PostHeader.js` | The card says "Meeting" or "Event" (and "All of 7BP") instead of "Event" |
| `apps/web/src/components/PostCard/PostTitle/PostTitle.js` (meetings and events) | Only a Meeting shows its meeting room |
| `apps/web/src/components/PostCard/EventBody/EventBody.js` (meetings and events) | "Meeting ended" or "Event ended", and the guest link box only on a Meeting |
| `apps/web/src/components/PostCard/EventBody/EventBody.test.js` | Checks that an Event never asks for a guest link |
| `apps/web/src/routes/PostDetail/PostDetail.js` (meetings and events) | The page title says Meeting or Event; "Join online" only for a Meeting |
| `apps/web/src/components/Calendar/calendar.tsx`, `calendar.module.scss` | Meetings have their own look (dashed) in every calendar view; `calendar.tsx` also takes a `headerExtra` button for the "Add to my calendar" button |
| `apps/backend/config/routes.js` (`skipAssets`) | The calendar feed and library download routes say `skipAssets: false`, so addresses ending in `.ics` or a file name reach the controller |
| `apps/web/src/graphql/fragments/postFieldsFragment.js`, `postCardFieldsFragment.js`, `apps/web/src/graphql/mutations/createPostMutation.js`, `updatePostMutation.js`, `apps/web/src/store/actions/createPost.js`, `updatePost.js`, `apps/web/src/store/models/Post.js` | Carry the kind and "for all of 7BP" to and from the server |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` (calendar) | The calendar page at `/calendar` |
| `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx` (calendar) | A Calendar button in the left bar |
| `apps/web/public/locales/*.json (meetings and events)` | Lists that hold both say "Meetings and events", the kind texts, the calendar page texts, in every language. The guide texts and the privacy notice about meetings changed in English only, like before |
| `apps/backend/migrations/schema.sql` (claimable profiles) | The new columns of `agora_contacts` for profiles people can claim later |
| `apps/backend/api/graphql/mutations/user.js`, `apps/backend/api/graphql/schema.graphql` (claim links) | Signing up can carry a claim link (`claimToken`), which counts as permission to make an account while sign-up is by invitation only |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (claim links) | The addresses for making and withdrawing claim links (Contacts, stewards only), and of the claim page: reading a profile needs only the link, claiming it a login |
| `apps/backend/.env.example` (claim links) | `AGORA_MAIN_GROUP_SLUG`, the main circle people join when they claim a profile |
| `apps/web/src/routes/RootRouter/RootRouter.js` (claim links) | The claim page at `/claim/<code>`, logged in or not |
| `apps/web/src/routes/NonAuthLayoutRouter/Signup/Signup.store.js` (claim links) | Sends a claim link along when signing up |
| `apps/web/public/locales/*.json (claim links)` | The texts of the claim page and of the profile and claim link parts of Contacts, in every language (the translations still to be checked) |
| `apps/backend/config/routes.js`, `policies.js` (remove sheet data) | The address where the person who claimed a profile deletes the sheet data in Contacts (login needed, only their own profile) |
| `apps/backend/config/routes.js`, `policies.js` (propose a profile) | The addresses for proposing a profile to a member (Contacts, stewards only) and for the member's own side: see the proposal, claim it without a link, "This isn't me" (login needed) |
| `apps/backend/lib/agora/contacts.js`, `apps/backend/api/controllers/AgoraContactsController.js` (propose a profile) | Contacts also carry who a profile is proposed to; only stewards get to see that |
| `apps/backend/migrations/schema.sql` (propose a profile) | The new columns `proposed_user_id`, `proposed_at` and the table `agora_claim_dismissals` |
| `apps/web/src/routes/AuthLayoutRouter/AuthLayoutRouter.js` (propose a profile) | Shows the dismissible "We found your profile" card inside the app |
| `apps/web/public/locales/*.json` (propose a profile) | The texts of the proposal card, the claim page and the Contacts part, in every language (translations still to be checked) |
| `apps/web/src/routes/ChatRoom/ChatRoom.js`, `Members/Members.js`, `Groups/Groups.jsx`, `MapExplorer/MapExplorer.js`, `OAuth/OAuthLayoutRouter.js`, `NonAuthLayoutRouter/NonAuthLayoutRouter.js`, `PostDetail/PostDetail.js`, `AuthLayoutRouter/AuthLayoutRouter.js`, `apps/web/src/router/index.js`, `apps/web/src/server/postMetaTags.js` (with its test), `apps/web/public/manifest.json`, `apps/web/index.html`, `apps/web/public/locales/*.json` (tab titles) | The browser tab says Agora on every page and while a page loads (for example "Chat \| Governance \| Agora"), shared links name Agora as the site, the home screen name is Agora, and the sign-in, sign-up and password reset tab titles say Agora in every language. The name comes from `apps/web/src/agora/appName.js` |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (kDrive) | The addresses of the circle Files pages when the files are in Infomaniak kDrive (list, download, add, new folder, rename, delete), for anyone logged in; each one checks that the person is a member of the circle |
| `apps/backend/migrations/schema.sql` (kDrive) | The two kDrive tables: which folder belongs to which circle, and who added which file |
| `apps/backend/config/routes.js`, `apps/backend/config/policies.js` (tasks) | The addresses of tasks in a circle (list, my tasks, meta, show, add, change, move, delete, restore, comments), for anyone logged in; each one checks that the person is a member of the circle |
| `apps/backend/migrations/schema.sql` (tasks) | The three task tables: `agora_tasks`, `agora_task_assignees` and `agora_task_comments` |
| `apps/backend/.env.example` (kDrive) | The four kDrive settings (`AGORA_KDRIVE_TOKEN`, `AGORA_KDRIVE_DRIVE_ID`, `AGORA_KDRIVE_ROOT_FOLDER_ID`, `AGORA_KDRIVE_MAX_UPLOAD_MB`), empty |
| `apps/web/public/locales/*.json (kDrive)` | Two new texts in the admin area's System tab, "kDrive (circle files)" and "No: AGORA_KDRIVE_ROOT_FOLDER_ID is missing", in every language |
| `.gitignore` | Ignores the demo login file, the uploads folder on a Mac, the build plan and the local notes for Claude |
| `package.json` | Skips building the old picture tool (sharp 0.32.6) of Hylo's first phone app. It cannot be built with Node 24 on a Mac, and Agora does not use that app. JSON allows no comments, so this line is the only note |

## Files that are new

- `README-AGORA.md`, `AGORA-CHANGES.md`
- `apps/web/src/agora/chat/AgoraMessageList.jsx`, `apps/web/src/agora/chat/AgoraMessageList.test.js` (the chat list), `apps/web/src/agora/passwordForms.test.js` (password manager marks on the login, reset, sign-up and account forms)
- `agora/setup-mac.sh`, `agora/setup-cloud.sh`, `AGORA-CLOUD.md`, `agora/start.sh`, `agora/tools.sh`, `agora/make-env.mjs`
- `agora/vps/setup-server.sh`, `agora/vps/server-env.mjs`, `agora/vps/update.sh`, `agora/vps/backup.sh` (the server at Infomaniak)
- `agora/vps/offsite-backup.sh`, `agora/vps/offsite-backup.conf.example` (an encrypted copy of the backups in object storage), `.github/workflows/agora-uptime.yml` (a warning when Agora is down)
- `agora/google-drive-login.mjs`
- `apps/backend/scripts/agora-init-db.js`, `apps/backend/scripts/agora-drive-link.js`
- `apps/backend/lib/agora/signup.js`, `apps/backend/api/controllers/AgoraSignupController.js`, `apps/backend/scripts/agora-allow-signup.js`, `apps/backend/test/unit/agora/signup.test.js`, `apps/backend/test/unit/agora/joinOnSignup.test.js`, `apps/backend/test/unit/agora/loggedOutJoinPage.test.js`, `apps/backend/test/unit/agora/diskUploads.test.js` (logged out gets 401), `apps/web/src/routes/GroupDetail/GroupDetailJoinAtTop.test.js`
- `apps/backend/lib/agora/mainGroup.js`, `apps/backend/scripts/agora-main-group.js`, `apps/backend/test/unit/agora/mainGroup.test.js` (the 7BP Home, the main circle)
- `apps/backend/lib/agora/thisWeek.js`, `apps/backend/api/controllers/AgoraThisWeekController.js`, `apps/backend/test/unit/agora/thisWeek.test.js`, `apps/web/src/agora/thisWeek/ThisWeek.jsx`, `apps/web/src/agora/thisWeek/ThisWeek.test.js` (This week in 7BP)
- `apps/backend/lib/agora/stewardRoles.js`, `apps/backend/scripts/agora-steward-roles.js`, `apps/backend/test/unit/agora/stewardRoles.test.js`
- `apps/backend/lib/agora/adminsEverywhere.js`, `apps/backend/scripts/agora-admins-everywhere.js`, `apps/backend/test/unit/agora/adminsEverywhere.test.js` (Agora admins are Administrator in every circle and space)
- `apps/web/src/agora/signup.js`, `apps/web/src/agora/AgoraInviteOnlyNotice.js`, `apps/web/src/agora/signup.test.js`
- `apps/web/src/agora/AgoraInvitationForOtherAccount.js`, `apps/web/src/agora/invitationAccount.test.js`, `apps/backend/test/unit/agora/inviteEmail.test.js` (an invitation email for another address, the invitation text, clean links in emails)
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
- `apps/web/src/agora/appName.js`, `apps/web/src/agora/appName.test.js` (the name in the browser tab, and the helper that builds tab titles)
- `apps/web/src/agora/contacts/ContactsPage.jsx`, `apps/web/src/agora/contacts/api.js`, `apps/web/src/agora/contacts/ContactsPage.test.js`
- `apps/backend/migrations/20261020120000_add_agora_claimable_profiles.js`, `apps/backend/lib/agora/claims.js`, `apps/backend/lib/agora/importProfiles.js`, `apps/backend/scripts/agora-import-profiles.js`, `apps/backend/api/controllers/AgoraClaimController.js`, `apps/backend/test/unit/agora/claims.test.js`, `apps/backend/test/unit/agora/importProfiles.test.js`, `apps/web/src/agora/claim/ClaimPage.jsx`, `apps/web/src/agora/claim/api.js`, `apps/web/src/agora/claim/ClaimPage.test.js` (profiles people can claim later)
- `apps/web/public/agora-7bp-logo.png`
- `apps/backend/migrations/20261018120000_add_agora_playbook.js`, `apps/backend/api/models/AgoraPlaybookChapter.js`, `apps/backend/lib/agora/playbook.js`, `apps/backend/api/graphql/agora/playbook.graphql`, `apps/backend/api/graphql/agora/playbook.js`, `apps/backend/test/unit/agora/playbook.test.js`
- `apps/web/src/agora/guide/GuidePage.jsx`, `guideParts.json` (the parts of the guide, shared by the page, the Help window and Claude), `guideParts.jsx`, `WelcomeSteps.jsx`, `useAgoraSeen.js`, `useMyCircle.js`, `guideUrl.js`, `GuidePage.test.js`, `WelcomeSteps.test.js` (the guide and the welcome steps)
- `apps/web/src/agora/playbook/PlaybookPage.jsx`, `apps/web/src/agora/playbook/PlaybookMenuLink.jsx`, `apps/web/src/agora/playbook/api.js`, `apps/web/src/agora/playbook/PlaybookPage.test.js`
- `apps/backend/migrations/20261012010000_add_agora_contacts.js`, `apps/backend/migrations/20261012020000_agora_meetings_deferrable.js`
- `apps/backend/lib/agora/diskUploads.js`, `apps/backend/test/unit/agora/diskUploads.test.js`, `apps/web/src/agora/directUpload.js`, `apps/web/src/agora/directUpload.test.js` (uploads on Agora's own disk)
- `apps/web/src/agora/legal/LegalPage.jsx`, `apps/web/src/agora/legal/legalTexts.js`, `apps/web/src/agora/legal/LegalPage.test.js` (the Terms of use and the Privacy notice)
- `apps/backend/migrations/20261019120000_add_agora_help_requests.js`, `apps/backend/lib/agora/help.js`, `apps/backend/lib/agora/helpClaude.js`, `apps/backend/lib/agora/helpGuide.md`, `apps/backend/api/controllers/AgoraHelpController.js`, `apps/backend/test/unit/agora/help.test.js` (Help and the Help desk; the reply email text is in `lib/agora/mailer.js`)
- `apps/backend/lib/agora/admins.js` (who is an Agora admin or Help desk admin), `apps/backend/lib/agora/adminDashboard.js`, `apps/backend/lib/agora/allowSignup.js` (the code of `scripts/agora-allow-signup.js`, also used by the admin area), `apps/backend/api/controllers/AgoraAdminController.js`, `apps/backend/test/unit/agora/adminDashboard.test.js` (the admin area; `lib/agora/help.js` asks `admins.js` who runs the Help desk, and `agora/vps/offsite-backup.sh` leaves a mark after each copy that worked)
- `apps/web/src/agora/admin/AdminPage.jsx`, `apps/web/src/agora/admin/api.js`, `apps/web/src/agora/admin/AdminPage.test.js` (the admin area page; the Help desk page `HelpDeskPage.jsx` is now its Help desk tab)
- `apps/web/src/agora/help/HelpWindow.jsx`, `apps/web/src/agora/help/HelpDeskPage.jsx`, `apps/web/src/agora/help/api.js`, `apps/web/src/agora/help/HelpWindow.test.js`, `apps/web/src/agora/help/HelpDeskPage.test.js`
- `apps/backend/migrations/20261103130000_add_agora_ask.js`, `apps/backend/lib/agora/ask.js`, `apps/backend/lib/agora/askIndex.js`, `apps/backend/lib/agora/askPermissions.js` (the permissions rule), `apps/backend/lib/agora/privateThemes.js` (the private messages policy), `apps/backend/lib/agora/infomaniakAI.js`, `apps/backend/api/services/AgoraAsk.js`, `apps/backend/api/controllers/AgoraAskController.js`, `apps/backend/scripts/agora-ask-reindex.js`, `apps/backend/test/unit/agora/ask.test.js`, `apps/backend/test/unit/agora/privateThemes.test.js` (Ask; `agora/vps/setup-server.sh` and `update.sh` install pgvector, and the Privacy notice has a part about Ask in `apps/web/src/agora/legal/legalTexts.js`)
- `apps/web/src/agora/ask/AskPage.jsx`, `apps/web/src/agora/ask/AskMenuLink.jsx`, `apps/web/src/agora/ask/api.js`, `apps/web/src/agora/ask/AskPage.test.js`
- `apps/web/src/agora/help/HelpGuide.jsx` (the Guide in the Help window), `apps/web/src/agora/help/openHelp.js` (opens Help on a given view from any page), `apps/backend/lib/agora/helpGuideText.js` (the guide as text for Claude in Help; `helpGuide.md` now holds only extra notes)
- `apps/backend/migrations/20261030120000_add_agora_meetings_and_events.js`, `apps/backend/lib/agora/eventKinds.js`, `apps/backend/lib/agora/calendar.js`, `apps/backend/api/controllers/AgoraCalendarController.js`, `apps/backend/api/services/AgoraCalendar.js`, `apps/backend/test/unit/agora/meetingsAndEvents.test.js` (Meetings and Events, the calendar and its feed; the invitation email text is in `lib/agora/mailer.js`)
- `apps/backend/lib/agora/hideSecrets.js` (keeps calendar link secrets out of logs and error reports), `apps/backend/lib/agora/postEditing.js` (who may change a post)
- `apps/web/src/agora/calendar/api.js`, `CalendarPage.jsx`, `AgoraEventKindFields.jsx`, `AgoraKindLabel.jsx`, `CalendarPage.test.js`, `AgoraEventKindFields.test.js`
- `apps/backend/migrations/20261021120000_add_agora_kdrive.js`, `apps/backend/lib/agora/kdrive.js` (every call to kDrive), `apps/backend/lib/agora/kdriveCircles.js` (circle folders and who may do what), `apps/backend/lib/agora/kdriveMinutes.js` (the copy of the minutes), `apps/backend/api/controllers/AgoraKdriveController.js`, `apps/backend/test/unit/agora/kdrive.test.js` (circle files in Infomaniak kDrive; `AgoraFilesController.js` sends the kDrive page when kDrive is set up, `MeetingSession.js` and `MeetingMinutes.js` save the minutes there, `adminDashboard.js` and `AdminPage.jsx` say whether it is set up)
- `apps/backend/migrations/20261023120000_add_agora_kdrive_links.js`, `apps/backend/lib/agora/googleLinks.js` (checks and cleans the address of a Google document), `apps/web/src/agora/files/FilesMenuLink.jsx`, `apps/web/src/agora/files/FilesMenuLink.test.js` (Google document links on the kDrive Files page, and the Files line in a circle's menu; the links are also handled in `kdriveCircles.js`, `AgoraKdriveController.js`, `FilesPage.jsx` and `kdrive.test.js`; `config/routes.js` has the one new address `/kd/link`)
- `apps/backend/test/unit/agora/agora.test.js`, `apps/backend/test/unit/agora/meetingLink.test.js`, `apps/backend/test/unit/agora/drive.test.js`, `apps/backend/test/unit/agora/meetingRoom.test.js`, `apps/backend/test/unit/agora/contacts.test.js`
- `apps/backend/migrations/20261104120000_add_agora_library.js`, `apps/backend/lib/agora/library.js`, `apps/backend/lib/agora/libraryStorage.js`, `apps/backend/lib/agora/libraryExtract.js`, `apps/backend/lib/agora/fileTexts.js`, `apps/backend/api/services/AgoraLibrary.js`, `apps/backend/api/controllers/AgoraLibraryController.js`, `apps/backend/scripts/agora-library-backfill.js`, `apps/backend/scripts/agora-library-check.js`, `apps/backend/test/unit/agora/library.test.js` (the circle library; `api/models/MeetingSession.js` files meeting notes in it, `api/services/Transcription.js` can wait longer for a long recording, and `lib/agora/diskUploads.js` never serves hidden folders such as the library's)
- `apps/web/src/agora/library/LibraryPage.jsx`, `apps/web/src/agora/library/api.js`, `apps/web/src/agora/library/LibraryPage.test.js`, `apps/web/src/agora/library/api.test.js` (the Resources tab as the circle library; `agora/vps/setup-server.sh` and `update.sh` install poppler-utils, unzip and ffmpeg for it)
- `apps/web/src/agora/files/FilesPage.jsx`, `FolderPicker.jsx`, `FileViewer.jsx`, `api.js`, `helpers.js`, `FilesPage.test.js` (the Files page inside the app: folders with a clickable path, a pop-up viewer for PDF, pictures, text, sound and video (`AgoraKdriveController.js` shows only those, with `?view=1`), download, add files, new folder, Google document links, rename, delete, move by dragging or with a folder picker, select several, sort by column; `apps/web/src/routes/SpaceContent/SpaceContent.js` has the one new route `files` for a space; the old `kdrive-files.html` is gone, `AgoraFilesController.js` sends the old address to the new page; `config/routes.js` has the new address `/kd/move`; `kdrive.js` has the move call; `kdriveCircles.js` has `moveItem`, the path of a folder and who added what when)
- `apps/backend/lib/agora/mainCircle.js`, `apps/backend/api/graphql/agora/mainCircle.js` and `.graphql`, `apps/backend/test/unit/agora/mainCircle.test.js`, `apps/web/src/agora/mainCircle/` (the 7BP Home look: which circle is the main one and its active children, the left bar order, the header pill and "Part of 7BP" link, the "Every circle in 7BP" cards, with tests)
- `apps/backend/migrations/20261029120000_add_agora_claim_proposals.js`, `apps/web/src/agora/claim/ProposedProfileBanner.jsx`, `apps/web/src/agora/claim/ProposedProfileBanner.test.js` (propose a profile to a member)
- `apps/backend/migrations/20261109120000_add_agora_tasks.js`, `apps/backend/lib/agora/tasks.js`, `apps/backend/api/controllers/AgoraTasksController.js`, `apps/backend/test/unit/agora/tasks.test.js` (tasks in a circle, optionally in a project: status columns, assignees, due date, comments; server only, no screen yet)

## Hylo sync of 3 November 2026

Hylo's `dev` (up to `d1ec91655a`, web/backend 7.1.8) was merged into Agora. Where Agora's change and Hylo's met:

- `apps/backend/lib/agora/mailer.js`: a text for Hylo's new "your email address is being changed" notice (`tem_gfCWyJRpp6Q996d6ykVgJKCW`), which goes to the old address and has no code or link. Without it the Agora mailer would skip it.
- `apps/web/src/routes/GroupSettings/PrivacySettingsTab/PrivacySettingsTab.jsx`: Hylo moved the Commons box into `CommonsRequestSection`; Agora's `showCommons` switch now wraps that component.
- `apps/web/src/routes/UserSettings/AccountSettingsTab/AccountSettingsTab.js`: Agora's real form and password-manager step now surround Hylo's new email verification (code box, resend, cancel).
- `apps/web/src/routes/RootRouter/RootRouter.js`: the claim page stays in the list of pages that need no waiting for login, next to Hylo's new `/h/invitation`, `/invite/` and `/view/`.
- `apps/web/src/routes/AuthLayoutRouter/components/GlobalNav/GlobalNav.jsx`, `TopNav/TopNav.jsx`: built on Hylo's new list of navigation items (groups and pinned spaces); Agora's 7BP panel, Commons switch and extra buttons were put back on top of it.
- `apps/web/src/store/actions/checkInvitation.js`: the description lists both `parentGroupId` (Agora) and `grantAccess` (Hylo).
- `apps/web/src/routes/GroupDetail/GroupDetailJoinAtTop.test.js` (new): Agora's test, moved out of `GroupDetail.test.js`, which is Hylo's again.
- `apps/web/public/locales/*.json`: merged key by key, every key of both sides kept.
- `apps/web/src/routes/JoinGroup/JoinGroup.js`: someone logged in is not joined straight from a Hylo link that only lets people see the circle (`grantAccess` false); they land on its About page and ask to join. `JoinGroup.test.js`: Hylo's new test for a member invitation uses a circle the person is not in and a refused join, because Agora sends a member straight into the circle.
- `apps/web/src/routes/GroupSettings/PrivacySettingsTab/PrivacySettingsTab.test.js`: Hylo's Commons box tests run with The Commons switched on.
- `apps/web/src/store/actions/__snapshots__/fetchPosts.test.js.snap`: updated for the two event fields Agora asks for (`agoraKind`, `agoraForAll`).

## Clean-up of 8 November 2026

- `apps/backend/api/services/Email.js`, `apps/backend/api/graphql/mutations/emailChange.js`, `apps/backend/api/graphql/mutations/emailChange.test.js`, `apps/backend/lib/agora/mailer.js`: the code mail for a changed email address is its own message (`sendEmailChangeCode`, text `agora_email_change_code`) and no longer reuses the sign-up text. With a SendWithUs key the old sign-up text is still used, because SendWithUs has no such text.
- `apps/backend/api/graphql/index.test.js`: Hylo's tests that read public groups, posts and profiles without logging in now check that Agora returns nothing.
- `apps/backend/test/setup/index.js`: the timeout is Hylo's again (50000). `test/setup/index.js.bak` removed.
- `apps/web/src/routes/CreateGroup/CreateGroupForm.jsx`, `apps/web/src/routes/AuthLayoutRouter/components/ContextMenu/SpaceSlugField.jsx`, `fitSpaceUrl.js` and their tests: the address preview shows the host of the running site (`window.location.host`) instead of hylo.com.
