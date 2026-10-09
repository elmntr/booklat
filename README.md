# Booklat

Offline, teacher-assisted oral reading assessment. Product context: [plan.md](plan.md).
This repository initializes a **two-developer React + FastAPI workflow**.

## Quick start (Arch Linux / zsh)

Prerequisites: `uv`, Node.js 24 (see `.nvmrc`), npm, and Git. Dependency installation
requires internet once; the integration demo makes no external requests at runtime.

```sh
uv sync --locked
npm ci
npm run dev
```

Open **http://localhost:5173**. API docs: **http://127.0.0.1:8000/docs**.
Both servers bind to loopback. Ctrl+C stops both. Alternatively run
`npm run dev:api` and `npm run dev:web` in separate terminals.
Python dependencies live in `.venv`; do not install into system Python.

Select a passage, start simulated reading, stop, then tap a marked word to override it.
This is a **development fixture**, not an assessment. The separate speech panel supports
microphone/file transcription after the optional setup below. Passage alignment,
database, CSV export, comprehension grading and official reading levels are not connected yet.
Session data resets
on API reload/restart. Fixture passages and learners are synthetic.

## Local speech recognition

The speech panel records a reading and transcribes it after Stop. The selected
passage determines the language: Filipino uses Whisper's `tl`, English uses `en`.
It also accepts an audio file. Recordings are limited to 120 seconds and 10 MiB;
audio is decoded in memory and is never saved or sent to an external service.

Download the [prepared CPU int8 model](https://github.com/elmntr/booklat/releases/tag/speech-model-v1)
and extract it into `models/` (see [model installation](models/README.md)). Then run:

```sh
npm run dev:speech
```

To download and convert the original weights yourself instead, run
`npm run speech:setup` before `npm run dev:speech`.

On this prepared machine, first run `source /home/law/Desktop/Booklat/dev-env.sh`
to select the installed Node 24 and uv. Stop any existing development servers before
running `dev:speech`, because both commands use ports 8000 and 5173.

Setup downloads the exact [`rbcurzon/whisper-medium-ph`](https://huggingface.co/rbcurzon/whisper-medium-ph)
checkpoint at revision `78c8f3e722ed5409eeb7c0b205bb3bf370cc19f5` (about 3.06 GB of
source weights). It converts the Transformers checkpoint to CTranslate2 int8 in
`models/whisper-medium-ph-ct2`, following [faster-whisper's conversion workflow](https://github.com/SYSTRAN/faster-whisper#model-conversion).
Conversion uses CPU-only PyTorch; runtime uses CPU int8 without PyTorch. Model
weights are distributed through GitHub Releases and excluded from Git history.
The upstream model card declares Apache-2.0; the release includes its license and attribution.

After setup, runtime loads only that local folder with `local_files_only=True`.
It does not download models during an assessment or fall back to simulated words.
The first transcription loads the model; `/api/health` reports `speech_available`
and `models_loaded` separately. One transcription runs at a time; another gets 409.
Microphone denial, missing models, invalid audio and upload limits surface as errors.

Decoding uses `temperature=0`, `condition_on_previous_text=False`, word timestamps,
and faster-whisper's bundled Silero VAD. The passage is never supplied as a prompt.
ONNX Runtime telemetry is disabled before it initializes, using
[`ORT_DISABLE_TELEMETRY=1`](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md).
The transcript and timestamps are component 2's output for a future aligner.
**No live passage marking or real assessment scores are produced by ASR yet.**
Medium is expensive on older CPUs; benchmark classroom speech and deliberate miscues
before relying on it. The model card does not claim reliable children's reading assessment.

On this machine (i3-7020U, two inference threads), two 8-second public speech clips
took 20.82 seconds for English (including first model load) and 19.11 seconds for
Tagalog (warm model). Both returned word timestamps without network access.
The Tagalog transcript contained errors; these smoke tests are not an accuracy
benchmark. Medium does not keep up with real time on this CPU in these checks.

For speech decoder coverage, run `uv run --locked --extra speech pytest` after setup.
The lightweight default checks skip only the decoder test when PyAV/NumPy are absent.

## Two-person ownership

| Developer | Owns | First delivery |
|---|---|---|
| A — backend / speech | `server/`, `data/`, `tests/`, `pyproject.toml`, `uv.lock` | Replace synthetic stream with local VAD → ASR → aligner; keep wire contract stable |
| B — frontend / audio | `web/` except generated client | Passage UX, microphone capture, 16 kHz PCM frames, results and override controls |
| Together | `contracts/`, root scripts, CI, integration docs | Agree on payloads before changing either side |

Frontend developers run the lightweight demo API locally: no speech model downloads
are needed. Backend developers use `/docs` and tests independently of the UI.
See [the team workflow](docs/TEAM.md) and [the integration contract](docs/INTEGRATION.md).

## Shared checks

```sh
npm run contract   # after backend schema changes; generates JSON + TypeScript
npm run check      # Python lint + lifecycle tests + TS check + production UI build
npm run contract:check # detects generated drift without modifying files
```

Commit `uv.lock`, `package-lock.json`, both contract JSON files, and
`web/src/api.generated.ts`. Never edit generated files directly. CI repeats these
checks for pushes and pull requests. `npm run build` builds the UI only; production
packaging and serving the UI from FastAPI remain backend integration work.

## Repository map

- `server/schemas.py`: canonical REST models and WebSocket word-event model
- `server/main.py`: local transcription endpoint and in-memory demo API
- `server/asr.py`: bounded audio decoding and offline faster-whisper inference
- `scripts/setup_speech.py`: pinned model download and CPU int8 conversion
- `web/src/SpeechCapture.tsx`: microphone/file input and transcript display
- `web/src/api.ts`: shared typed REST client and WebSocket validation
- `contracts/`: generated, reviewable wire schemas
- `data/passages/`: original development fixtures
- `tests/`: HTTP + WebSocket lifecycle coverage

The dev proxy follows [Vite's server proxy configuration](https://vite.dev/config/server-options#server-proxy).
Backend integration tests use [FastAPI's WebSocket test client](https://fastapi.tiangolo.com/advanced/testing-websockets/).
