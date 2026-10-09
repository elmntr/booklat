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
This is a **development fixture**, not an assessment: no mic, ASR, VAD, database,
CSV export, comprehension grader or official reading levels yet. Session data resets
on API reload/restart. Fixture passages and learners are synthetic.

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
- `server/main.py`: runnable, in-memory demo API
- `web/src/api.ts`: shared typed REST client and WebSocket validation
- `contracts/`: generated, reviewable wire schemas
- `data/passages/`: original development fixtures
- `tests/`: HTTP + WebSocket lifecycle coverage

The dev proxy follows [Vite's server proxy configuration](https://vite.dev/config/server-options#server-proxy).
Backend integration tests use [FastAPI's WebSocket test client](https://fastapi.tiangolo.com/advanced/testing-websockets/).
