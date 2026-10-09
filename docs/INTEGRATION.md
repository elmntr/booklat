# Integration contract v0.1

Canonical models: `server/schemas.py`. Generated REST schema: `contracts/openapi.json`.
Generated WebSocket schema: `contracts/word-event.schema.json`.
The frontend calls relative `/api` and `/ws` URLs through Vite's local proxy;
there are no separate browser-side backend URLs or CORS settings to synchronize.

## Implemented REST routes

| Method | Route | Response |
|---|---|---|
| GET | `/api/health` | Demo mode plus local speech availability and model-loading state; no runtime network required |
| GET | `/api/learners` | Synthetic learners |
| GET | `/api/passages` | Passage text and canonical ordered `words` |
| POST | `/api/sessions` | 201 session; body `{learner_id, passage_id}` |
| GET | `/api/sessions/{session_id}` | Current state and marks |
| POST | `/api/sessions/{session_id}/stop` | Idempotent stopped session |
| PATCH | `/api/sessions/{session_id}/words/{idx}` | Updated session; body `{status}` |
| POST | `/api/transcribe?language=fil` | Transcript and word timestamps; raw encoded audio body |

## Speech transcription (component 2)

`POST /api/transcribe` consumes a raw WAV, WebM, MP4 or Ogg recording with
`Content-Type: application/octet-stream`. The `language` query accepts `fil` (default)
or `en`; Filipino maps to Whisper's `tl`. The response is separate from demo sessions:

```json
{"text":"May aklat si Ana.","language":"tl","duration_s":2.5,"model":"rbcurzon/whisper-medium-ph","words":[{"word":"May","start":0.1,"end":0.4,"probability":0.9}]}
```

Word timestamps are seconds in the submitted audio, not passage indices. These are
ASR hypotheses, not correct/error judgements. Nothing is written to session marks.
No transcript or audio is persisted; the caller displays the response.

Upload bytes are bounded while receiving (10 MiB); decoding resamples to mono 16 kHz
and rejects audio exceeding 120 seconds before inference. Empty/undecodable/overlong
audio returns 422, oversized uploads 413, concurrent inference 409, unavailable
dependencies/model 503. Unexpected inference failures return 500. The existing
synthetic WebSocket endpoint is unchanged and must not receive microphone audio.

`/api/health` keeps `mode: demo` for the passage-marking fixture and adds
`speech_available`, `speech_model`, and `speech_error`. `models_loaded` becomes true
after the speech model has successfully loaded. The speech panel is enabled only
when local dependencies and converted model assets exist. Use `npm run dev:speech`
to keep the optional speech dependencies installed; `npm run dev` remains lightweight.

Use the server's words array; do not independently tokenize the text. Indices are
zero-based. Missing resources return 404; invalid request data 422; overriding an
active session returns 409. Errors use FastAPI's `detail` envelope. Overrides in this
scaffold are allowed only after stop and only for already marked words.
Unreached words remain unmarked. Metrics and level are nullable, not invented scores.

## WebSocket demo

Connect `/ws/read/{session_id}` for an active session. The server sends one JSON event
per word, every 250 ms, with a deliberate substitution at index 2:

```json
{"type":"word","session_id":"<id>","passage_index":0,"status":"correct","heard_word":"Ana","t":0.0}
```

`t` is synthetic seconds from stream start. Word statuses currently supported:
`correct`, `substitution`, `mispronunciation`, `omission`, `repetition`.
There is one mark per passage index; a new event for that index replaces the display.
Only one socket per session is accepted. Invalid/stopped/duplicate connections are
rejected (policy violation 1008 before accept; browsers may report 1006).
Normal completion closes with 1000. The UI must still POST stop to finalize.
Reconnecting an active demo session continues after stored marks. Stop prevents
further events; GET session is authoritative after an interruption.

## Next contract agreement: streaming audio (not implemented)

Before wiring microphone capture, jointly define:
- Client binary PCM: signed Int16 little-endian, mono 16,000 Hz, approximately 250 ms
  per frame (4,000 samples / 8,000 bytes), no WAV header.
- An explicit start/ready handshake, input limits and backpressure policy.
- Stop/end-of-audio acknowledgement that flushes pending VAD/ASR before final scoring.
- Event revisions, repeats, and insertions as separate occurrences, so repetitions
  do not erase the underlying word mark and insertion events do not fake indices.
- Error/end events, reconnect replay, and timestamps from audio rather than wall time.

Do not send audio to the current demo endpoint; it does not consume PCM frames.
REST alone is described by OpenAPI; WebSocket event schema is exported separately.

## Remaining backend boundaries

Add `aligner.py`, `scorer.py`, and `db.py` as the implementation grows.
Keep ML dependencies optional so frontend contributors can retain lightweight setup.
Scoring rules must be validated against the manual before returning reading levels.
SQLite, CSV export and comprehension endpoints in the original plan are not yet implemented.

## Microphone capture (implemented, local check only)

`web/src/audio.ts` exposes `captureMicrophone(signal, onFrame, onError)`.
It returns an async `stop()` that flushes the final partial frame before cleanup.
Aborting the signal cancels capture immediately, including late permission grants.
`onFrame` receives `{ pcm: ArrayBuffer, rms: number }`:

- Signed PCM16 little-endian, mono 16 kHz, no header.
- Full frames: 4,000 samples / 8,000 bytes / 250 ms.
- The final frame can be shorter; consume its byte length, not a fixed size.
- A 16 kHz AudioContext performs device-rate conversion; unsupported browsers fail
  explicitly. See [AudioContext sample rate](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/sampleRate).
- Microphone check discards every frame after updating the meter/counts. No recording
  is accumulated, saved, or transmitted. The meter is RMS scaled for display.

Backend handoff: call this helper only after the future audio-ready handshake;
forward each `pcm` buffer via the agreed transport with bounded backpressure.
Await `stop()` before sending end-of-audio and waiting for the backend flush/score.
Abort capture on transport failure or component unmount. No backend files or wire
schemas were changed for this feature.

Run `npm run test:audio` for PCM and mocked resource-lifecycle tests.
Manual hardware check in Chrome at localhost: start microphone check, allow access,
speak and confirm the meter moves, stop and verify the browser mic indicator turns
 off. Repeat with blocked permission, unplugged microphone and cancellation while
permission is pending. Hardware/device-rate conversion still needs a physical mic check.
