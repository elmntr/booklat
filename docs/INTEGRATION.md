# Integration contract v0.1

Canonical models: `server/schemas.py`. Generated REST schema: `contracts/openapi.json`.
Generated WebSocket schema: `contracts/word-event.schema.json`.
The frontend calls relative `/api` and `/ws` URLs through Vite's local proxy;
there are no separate browser-side backend URLs or CORS settings to synchronize.

## Implemented REST routes

| Method | Route | Response |
|---|---|---|
| GET | `/api/health` | `status: ok`, `mode: demo`, `models_loaded: false`, `network_required: false` |
| GET | `/api/learners` | Synthetic learners |
| GET | `/api/passages` | Passage text and canonical ordered `words` |
| POST | `/api/sessions` | 201 session; body `{learner_id, passage_id}` |
| GET | `/api/sessions/{session_id}` | Current state and marks |
| POST | `/api/sessions/{session_id}/stop` | Idempotent stopped session |
| PATCH | `/api/sessions/{session_id}/words/{idx}` | Updated session; body `{status}` |

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

## Next contract agreement: real audio (not implemented)

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

Add `server/asr.py`, `aligner.py`, `scorer.py`, and `db.py` as the implementation grows.
Keep ML dependencies optional so frontend contributors can retain lightweight setup.
Scoring rules must be validated against the manual before returning reading levels.
SQLite, CSV export and comprehension endpoints in the original plan are not yet implemented.
