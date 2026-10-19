# Agora video and meeting notes: plan

Written 19 October 2026. All web pages below were opened on that date.

Guy's choice (19 October): kMeet by Infomaniak for the calls, Infomaniak AI Tools (Whisper V3) for speech to text. Transcripts only for now: no video recordings, no own Jitsi server.

## In short

- **kMeet** is free, has no time limit, and its server does not block being shown inside another site. Agora's room already loads it that way. Nobody has tried it with real people yet.
- **Infomaniak speech to text** costs CHF 0.006 per minute of processing time, and the first 1 million credits are free. It accepts the sound the room sends (webm from Chrome, Firefox and Edge, mp4 from Safari).
- **The code did not match Infomaniak.** Infomaniak does not send the text back straight away. It sends a ticket number (`batch_id`) and the text has to be fetched a moment later. The old code read every answer as silence, so every meeting would have ended with "nothing was transcribed" and no error anywhere. This pull request fixes that.
- After this pull request, Guy adds three lines to the server's settings, restarts, and runs the ten-minute test below.

## 1. Facts checked

### 1a. kMeet

| Question | Answer | Source |
|---|---|---|
| Free? | Yes. "The secure, unlimited and free videoconferencing service." Joining needs no account. | [infomaniak.com/en/ksuite/kmeet](https://www.infomaniak.com/en/ksuite/kmeet) |
| Time limit | None stated ("unlimited"). | same page |
| Participants | Infomaniak's guide says "There is no limit to the number of participants with the paid kSuite plans". For the free version no number is given; app stores say "unlimited (subject to resources)", one outside review says 100. Fine for 10 to 30 people. | [FAQ 2475, updated 13 Oct 2026](https://www.infomaniak.com/en/support/faq/2475/create-a-kmeet-meeting), [F-Droid listing](https://f-droid.org/ru/packages/com.infomaniak.meet/index.html), [InfoSwitch review](https://infoswitch.fr/en/blog/kmeet-alternative-zoom-google-meet) |
| Can it be shown inside Agora's page? | Not documented by Infomaniak either way. Checked by hand: `kmeet.infomaniak.com` sends no `X-Frame-Options` and no `frame-ancestors` rule, so browsers allow it inside another page. Its `external_api.js` (the Jitsi "IFrame API" script the room uses) is served. Its `config.js` does **not** set `disableIframeAPI` (meet.jit.si does, see 1d). So it should work, but only the real test proves it. | `curl -I https://kmeet.infomaniak.com/`, [kmeet.infomaniak.com/config.js](https://kmeet.infomaniak.com/config.js) |
| API | Only the standard Jitsi IFrame API, which the room uses. No public kMeet REST API was found. | [Jitsi IFrame API](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe) |
| Recording | kMeet can record to kDrive (needs an Infomaniak account). Not needed now. Its config also switches on Jitsi's own subtitles button and "local recording". | kMeet page, `config.js` |
| Things to know | kMeet's `config.js` reports some button clicks to Infomaniak's own Matomo (`analytics.infomaniak.com`). That is Infomaniak's statistics, not Agora's, but it is worth one sentence in Agora's privacy text. Everything passes through Infomaniak's servers in Switzerland. | `config.js`, kMeet page |

### 1b. Infomaniak AI Tools speech to text (the main part)

| Question | Answer | Source |
|---|---|---|
| Price | Whisper V3: **CHF 0.006 per minute**. Note: it is "billed per minute of generation", meaning the time Infomaniak's computers spend, not the length of the sound. That is normally much shorter than the speech itself. 1 million free credits to start. Prices without VAT. | [AI Services prices](https://www.infomaniak.com/en/hosting/ai-services/prices), [AI Services FAQ](https://www.infomaniak.com/en/hosting/ai-services) |
| What a meeting costs | Upper bound: a one-hour meeting with four people where someone is always talking is about 60 minutes of speech, so at most CHF 0.36, likely far less. | worked out from the price |
| Endpoint | `POST https://api.infomaniak.com/1/ai/{product_id}/openai/audio/transcriptions`. `{product_id}` is the number of your AI Tools product (shown in the Infomaniak manager, or by `GET /1/ai`). | [API docs: Create transcription](https://developer.infomaniak.com/docs/api/post/1/ai/%7Bproduct_id%7D/openai/audio/transcriptions) |
| Login | Header `Authorization: Bearer <Infomaniak API token>`. | same page, code sample |
| Model name | **`whisper`** (not OpenAI's `whisper-1`). Required. | same page: `"model": "whisper"` |
| Sync or async | **Async.** "This route is asynchronous." The answer is only `{"batch_id": "..."}`. Then `GET /1/ai/{product_id}/results/{batch_id}` until `status` is `success` (other values: `pending`, `processing`, `failed`, `cancelled`). The text is in `data`: with `response_format=json` it is a string like `{"text": "..."}`. A separate `/download` route gives the same as a file. | same page; [API docs: Get result](https://developer.infomaniak.com/docs/api/get/1/ai/%7Bproduct_id%7D/results/%7Bbatch_id%7D); a real-world report with example answers: [fgrng/failure_on_the_fly#232](https://github.com/fgrng/failure_on_the_fly/issues/232) |
| How fast | The report above: five minutes of sound came back in about two seconds. Our pieces are 3 to 30 seconds. | issue #232 |
| Formats | API docs: `mp3, mp4, aac, wav, flac, ogg, opus, wma, m4a, webm`. (The marketing page leaves out webm, the API docs list it, and issue #232 confirms webm works.) A wrong type is refused with error 422 `validation_rule_mimes`. | API docs; [model page](https://www.infomaniak.com/en/hosting/ai-services/open-source-models) |
| Size | Model page: maximum 25 MB per file. Our pieces are at most 30 seconds at 32 kbit/s, about 120 KB. | model page |
| Language | Optional `language` field. The docs warn: "Supplying the input language will translate the output." So only set it if everyone speaks that language. Leave it empty for mixed meetings. | API docs |
| Where data goes | Data centres in Switzerland. "No queries are stored." The result does sit at the `results/{batch_id}` address for a while; how long is not documented. | [AI Services page](https://www.infomaniak.com/en/hosting/ai-services) |

**What Agora sent, compared with what Infomaniak expects (before this pull request):**

| What | Agora's code | Infomaniak | Problem? |
|---|---|---|---|
| Answer | Read `text` from the first answer | First answer is only `batch_id` | **Yes, the big one.** `data.text` was empty, so every piece was saved as "empty" (silence), the sound was deleted, and no error was logged. Every meeting would end with "Nothing was transcribed". |
| Model | Default `whisper-1` | `whisper` | **Yes.** Probably refused. Now the default is `whisper` when the address is Infomaniak's. |
| Key missing | Room said "notes on" as long as there was an address | Infomaniak always needs a key | **Yes.** Every piece would fail with 401. Now an Infomaniak address without a key counts as "not connected" and the room says notes are off. |
| Sound format | Chrome, Edge, Firefox: `audio/webm;codecs=opus`, sent as `speech.webm`. Safari: `audio/mp4`, sent as `speech.m4a` | webm, mp4, m4a allowed | No. Each piece is a complete file (a new recorder per piece), so it can be read on its own. |
| Size | At most 4 MB accepted by Agora, pieces about 120 KB | 25 MB | No. |
| Form fields | `file`, `model`, `response_format=json`, optional `language` | same names (OpenAI format) | No. |
| Login header | `Authorization: Bearer <key>` | same | No. |
| Waiting | One request with a 2-minute limit | Needs polling | Fixed: now polls every 1.5 seconds within the same 2 minutes. |

### 1c. Own Jitsi server

Not needed now (Guy's choice). For later: one 4 vCPU / 8 GB Infomaniak Public Cloud instance costs CHF 16.10 a month ([prices](https://www.infomaniak.com/en/hosting/public-cloud/prices)) and fits 10 to 30 people at normal quality; recording (Jibri) needs a second machine of at least 8 GB per recording at the same time ([Jitsi requirements](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/)). Setting it up is about a day; keeping it updated is ongoing work.

### 1d. meet.jit.si and Google Meet

- **meet.jit.si** (the public Jitsi server): its live `config.js` sets `disableIframeAPI: true` and asks people to sign in to start a room, so it cannot be shown inside Agora. Jitsi points people who want to embed to its paid service JaaS (it has a free tier for up to 25 users). [meet.jit.si/config.js](https://meet.jit.si/config.js), [jitsi.org/jaas](https://jitsi.org/jaas/)
- **Google Meet** cannot be shown inside another page: it sends `X-Frame-Options: SAMEORIGIN` (checked). Agora could only link to it. Since 19 October that is no longer possible: Guy decided that calls always go through Agora's own meeting room on kMeet, so events have no field for another platform's link (see "Meetings" in README-AGORA.md). Google's own transcripts need Workspace Business Standard or higher ([Google help](https://support.google.com/meet/answer/12849897?hl=en)); Business Standard for nonprofits is about USD 3.50 per user per month ([Google for Nonprofits](https://google.com/intl/en-GB/nonprofits/workspace/compare)). Not needed with kMeet.

### 1e. Other Infomaniak video products

- **Video streaming** (live broadcasts for large audiences): extras start at CHF 20.45 to 52.75 a month (transcoding from CHF 52.75, archiving from CHF 26.90); the base price was not in the page text. [Streaming](https://www.infomaniak.com/en/multimedia/streaming/video)
- **VOD/AOD** (hosting recordings, embeddable player): no price found in the page text. [VOD](https://www.infomaniak.com/en/multimedia/vod-aod)
- Neither is needed for transcripts. Useful later if 7BP wants to stream a large assembly.

## 2. Settings Guy adds

On the server, in `/srv/agora/apps/backend/.env` (Guy does this himself; never paste keys into a chat):

```
AGORA_MEET_DOMAIN=kmeet.infomaniak.com
AGORA_TRANSCRIPTION_URL=https://api.infomaniak.com/1/ai/<PRODUCT_ID>/openai/audio/transcriptions
AGORA_TRANSCRIPTION_KEY=<INFOMANIAK_API_TOKEN>
AGORA_TRANSCRIPTION_MODEL=whisper
AGORA_TRANSCRIPTION_LANGUAGE=
```

- `<PRODUCT_ID>`: the number of the AI Tools product in the Infomaniak manager (AI Tools, then the product; it is also in the address bar).
- `<INFOMANIAK_API_TOKEN>`: made in the Infomaniak manager under API tokens, with the AI Tools scope.
- `AGORA_MEET_DOMAIN` is probably already there (it is in `.env.example`); check it is not empty.
- `ANTHROPIC_API_KEY=` can stay empty for now. Then the minutes post holds the full transcript, who was there, and the note "The assistant is not connected yet, so here is the transcript as it was heard." It is still posted in the event's group, by the "Agora Assistant" account. Checked in `MeetingSession.finalize` and `MeetingMinutes.renderHtml`; covered by the test "falls back to the transcript when there is no summary". The room also says so before people join: "You will get the full transcript, but no summary."

Then restart both parts (the worker does the speech to text):

```
sudo systemctl restart agora-api agora-worker
```

## 3. Ten-minute test with 3 or 4 people

**Before (Guy, 5 minutes):**
1. Merge this pull request and update the server (`agora/vps/update.sh`).
2. Add the settings above and restart.
3. Make an event in a test circle, with all testers as members. Copy the room address: `https://agora.guyvankoolwijk.nl/noo/meeting/<event id>/room`.
4. Open two terminal windows on the server:
   - `sudo journalctl -u agora-api -f` (the room's calls)
   - `sudo journalctl -u agora-worker -f` (speech to text and the minutes; **most of what matters shows here**)

**Who uses what:** ideally one Chrome on a laptop, one Firefox, one Safari on a Mac, one iPhone or Android phone. **Everyone uses headphones** (otherwise one person's microphone picks up the others and lines get doubled under the wrong name).

**Minute 0 to 2: joining.**
- Everyone opens the room address and logs in.
- Check: the page says "This meeting writes its own minutes" (not "Notes are off"). If it says notes are off, the address or key is missing.
- Three people press "Join the meeting". One person presses "Join, but keep my voice out of the notes".
- Check: the call appears inside the page (kMeet), everyone sees and hears each other, the browser asks for the microphone once or twice, and the pill at the top says "Listening". The person without notes sees "Your voice is not in the notes". The "Here:" line lists everyone, with "(not in notes)" after one name.
- Log: `POST /noo/meeting/<id>/join` lines in agora-api.

**Minute 2 to 6: talking.**
- Each person says two or three full sentences in turn, with their name in them ("This is Amara, I will write the agenda by Friday"). Then one short exchange where two people talk over each other.
- Check: lines appear in "Notes so far" within about 5 to 10 seconds, under the right name, in the right order.
- Worker log, per piece: `Job N: MeetingSegment.transcribe` then `Job N: done`. An error line here means speech to text fails: a `401` or `403` is the key or product id, `422 validation_rule_mimes` is the sound format (note which browser), `was not ready within 120 seconds` means Infomaniak is slow.
- If something fails, the room now shows: "Speech to text is having trouble ...".

**Minute 6 to 8: mute and pause.**
- One person mutes in the kMeet bar: their pill says "You are muted" and nothing of theirs appears. Unmute: "Listening" again.
- One person presses "Pause my notes", says a sentence, presses "Resume my notes". That sentence must **not** appear.
- The person who joined without notes speaks: they must be heard in the call, and nothing must appear under their name.

**Minute 8 to 10: ending.**
- One person presses "End meeting", then confirms.
- Check: everyone's page changes to "The meeting has ended" (within about 4 seconds for the others). Within about 1 to 2 minutes the page says "The minutes are posted in the group" with a link.
- Worker log: `MeetingSession.finalize`, then `done`.
- Open the minutes post: transcript with names and times, "Who was there" with all four names.

**Optional check in the database** (read only):
`sudo -u postgres psql agora -c "select status, count(*), max(error) from meeting_segments group by status"`
Pass: mostly `done`, a few `empty` (coughs), no `failed`, and no sound left: `select count(*) from meeting_segments where audio is not null` gives 0 after the meeting.

**Pass:**
- The call works inside the page for everyone, on at least Chrome and one other browser.
- At least 8 of every 10 spoken sentences appear, under the right name.
- Mute, pause and "keep my voice out" leave nothing in the notes.
- The minutes post appears in the group within 3 minutes of ending.

**Fail (write down which browser and what the log said):**
- No call inside the page, or the call never "joins" (pill stays on "Waiting for the call").
- No lines at all, or errors in the worker log.
- Text from a paused or muted person, or from the person who opted out.
- No minutes post after 10 minutes.

## 4. Gaps between "built" and "working fully"

Fixed in this pull request:

| Gap | Size | Status |
|---|---|---|
| Infomaniak answers with a `batch_id`; the code took that for silence and lost all speech without a trace | small | **Fixed**: polls the result; an answer without text or batch_id is now an error, never silence |
| Default model `whisper-1` is wrong for Infomaniak | small | **Fixed**: `whisper` by default for Infomaniak's address |
| Infomaniak address without key looked "connected" | small | **Fixed**: counts as not connected, room says notes are off |
| Failures were invisible to people in the room | small | **Fixed**: room shows "Speech to text is having trouble" once |
| A computer with a wrong clock had all its speech refused (400) without a message | small | **Fixed**: the arrival time is used instead |
| Safari can start the sound engine paused when it is not created right on a click; then the page hears nothing and records nothing | small | **Fixed** (untested on a real iPhone): the page wakes it, and again on the next tap |

Still open:

| Gap | Size | Notes |
|---|---|---|
| kMeet inside the page has never been tried with real people | small | The test above |
| If kMeet loads but the call never starts (a lobby, a password, a blocked camera), the page waits on "Waiting for the call" forever and records nothing | small | Add a time-out with the "open the call in its own window" fallback |
| Phones: the call and Agora's own listening both use the microphone. Desktop browsers allow that; iPhones may stop one of the two. Locking the screen stops everything | medium | Test on a real iPhone and Android. If it fails, phones get "join without notes" or the kMeet app plus this page |
| When the tab is in the background, browsers slow down the page's timer, so pauses are noticed late and pieces get longer | medium | Move the listening into an AudioWorklet; acceptable for now |
| Echo: without headphones one person's microphone records others, under the wrong name | medium | Ask for headphones in the lobby text; later compare timing to drop doubles |
| Consent covers Agora's notes only. kMeet's own buttons (record to kDrive, subtitles, local recording) are still in the call | small | Hide them with `toolbarButtons` in the room's `configOverwrite`, and add one line about kMeet to the privacy text |
| Lines from different people are ordered by each person's own clock | small | Fine within seconds; fixed only for clocks that are far off |
| When someone ends the meeting, pieces still waiting in other people's browsers are dropped | small | Accept speech for a minute after the end |
| Nothing tells Guy when speech to text keeps failing over many meetings | small | A daily line in the log or an email to stewards |
| How long Infomaniak keeps results at `results/{batch_id}` is not documented | small | Ask Infomaniak support; mention in the privacy text |
| Claude minutes (`ANTHROPIC_API_KEY`) not set | none | Transcript-only minutes work; add the key later |
| Running all Agora tests in one go fails to load one test file on this Mac (each file passes on its own) | small | Seen with a borrowed `node_modules`; check on the cloud machine |

## 5. Recommendation

1. Merge this pull request, add the three Infomaniak lines, and run the ten-minute test with four people on four different browsers.
2. Keep kMeet inside the page; use the second-window fallback only if the test shows kMeet cannot be shown inside it.
3. Next build steps after the test: the "call never starts" time-out and hiding kMeet's own recording buttons (both small), then the phone check.
