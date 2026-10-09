# Booklat: offline oral-reading assessor for Filipino public-school teachers

*Name: a play on Tagalog "buklat" (to open a book) and "book". Tagline: "Phil-IRI in minutes, offline."*

> **One line:** A teacher opens Booklat on a laptop or phone with no internet. A learner reads a graded passage aloud. Booklat marks each word correct, wrong, skipped or repeated *as it is spoken*, then calculates reading speed, accuracy and reading level, and saves the result to the class reading profile. No audio ever leaves the device.

---

## 1. General overview

### The problem
- DepEd requires the **Phil-IRI** (Grades 3–6). Learners who score low on the group screening test must then read graded passages aloud, one at a time ([DO 14 s.2018](https://www.teacherph.com/revised-phil-iri/)). K–3 learners also go through CRLA.
- Teachers do this with a **printed passage, a stopwatch and a pen**: they listen, mark miscues by hand, count words, compute scores and copy results into forms. Teachers describe the individual oral test as time-consuming ([IJFMR 2025](https://www.ijfmr.com/papers/2025/3/44181.pdf)).
- Many of the schools that most need this have **unreliable or no internet** ([Inquirer](https://newsinfo.inquirer.net/2080790/deped-to-connect-all-public-schools-to-the-internet-within-2025)). The recordings are **children's voices**, which fall under NPC child-data guidance ([NPC](https://privacy.gov.ph/wp-content/uploads/2024/12/Advisory-2024.12.17-Guidelines-on-Child-Oriented-Transparency-w-SGD.pdf)).

### Who it's for
**Ma'am Liza**, a Grade 3 teacher and school reading coordinator in a school with no stable signal. She has to test her struggling readers individually in Filipino and English every school year.

### How it works (user flow)
1. **Pick a learner and a passage.** Liza selects a learner from her class list and a graded passage (Filipino or English, by grade level).
2. **Tap "Start" and the learner reads aloud** from the paper or the screen.
3. **Live marking.** Each word on Liza's screen changes colour as the learner reads:
   - 🟩 correct  🟥 substituted or mispronounced  ⬜ (struck through) skipped  🟨 repeated  ➕ inserted word shown in the gap
4. **Liza can override anything.** Tapping a word cycles its mark, because the teacher has the final say (and the model will make mistakes).
5. **Tap "Stop" to see results:** reading time, words correct per minute, word-reading accuracy %, miscue counts by type, and the **reading level** (Independent / Instructional / Frustration) from the Phil-IRI thresholds.
6. **Optional comprehension check.** The learner answers the passage questions aloud. Booklat transcribes the answer and suggests correct / partial / incorrect. Liza confirms.
7. **Saved to the class profile.** Liza can export a CSV laid out like the Phil-IRI class summary form.

### Why it must run locally
| Reason | What it means |
|---|---|
| **No connectivity** | The test happens in the classroom, where there's often no signal. A cloud tool fails exactly there. |
| **Child privacy** | The input is minors' voices linked to names and reading levels. Keeping it on the device keeps it out of central databases (cf. the DepEd OVAP exposure of 210,020 records, [Inquirer](https://technology.inquirer.net/132322/ph-platform-ovap)). |
| **Real-time** | Words have to be marked as the child reads them. A round trip on a weak connection breaks the loop. |
| Cost (minor) | No per-minute API fees. Be honest on stage: connectivity and privacy are the main reasons, not cost. |

### What makes it different
Automated reading assessment has been piloted before (RTI/USAID/DepEd CoBRA, [RTI](https://shared.rti.org/content/computer-based-reading-assessment-pilot-report)). Booklat's angle is **offline, run by the teacher, scored to Phil-IRI miscue categories, and filling in forms**, on hardware a school already has.

---

## 2. System architecture

### High level
```
┌──────────────────────────── Teacher's laptop (airplane mode) ────────────────────────────┐
│                                                                                          │
│  ┌─────────────── Browser UI (localhost) ───────────────┐                                │
│  │  Roster · Passage picker · Live passage view         │                                │
│  │  Mic capture (Web Audio, 16 kHz mono PCM)            │                                │
│  │  Results card · Override taps · CSV export           │                                │
│  └───────────────┬──────────────────────▲───────────────┘                                │
│        audio chunks (WebSocket)    word events (WebSocket)                               │
│                  ▼                      │                                                │
│  ┌────────────── Local API server (Python, FastAPI) ─────────────────────────────────┐   │
│  │                                                                                   │   │
│  │  [1] Silero VAD  ──► [2] ASR: faster-whisper  ──► [3] Aligner  ──► [4] Scorer     │   │
│  │      (cut on pause)     (word timestamps)         (passage vs heard) (WPM, %,     │   │
│  │                                                                     level)        │   │
│  │                                                                                   │   │
│  │  [5] Comprehension grader (optional): Gemma 4 E2B via Ollama / llama.cpp          │   │
│  │                                                                                   │   │
│  │  [6] Storage: SQLite (learners, passages, sessions, word marks)                   │   │
│  └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│  (Optional, later) Sync service: pushes anonymised class summaries when online           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components

| # | Component | Choice | Why | Notes / sources |
|---|---|---|---|---|
| UI | Web front end | Vite + React (or plain HTML/JS if faster for your team) | Runs in any browser; easy to demo | Served from `localhost` |
| Mic | Audio capture | `getUserMedia` + AudioWorklet, downsample to 16 kHz mono Int16, send ~250 ms frames | Whisper expects 16 kHz | Works on localhost without HTTPS |
| 1 | Voice activity detection | **Silero VAD** | Cuts audio at the child's pauses so each chunk is short; drops silence | MIT ([repo](https://github.com/snakers4/silero-vad)) |
| 2 | Speech recognition | **faster-whisper** `small` by default; try `rbcurzon/whisper-medium-ph` for Filipino | Local, CPU-friendly, gives **word timestamps** | Whisper code and weights MIT ([README](https://github.com/openai/whisper/blob/main/README.md)); whisper-medium-ph Apache-2.0 ([card](https://huggingface.co/rbcurzon/whisper-medium-ph/blob/main/README.md)); approximate memory: small about 600 MB, medium about 1.7 GB ([whisper.cpp](https://github.com/ggml-org/whisper.cpp/discussions/467)) |
| 3 | Aligner | Our own code: incremental alignment of heard words to passage words | **The core trick.** The passage is known, so we compare instead of free-form transcribing | See §2.3 |
| 4 | Scorer | Pure Python | WPM, accuracy, miscue counts, reading level | Thresholds in a config file, copied from the [Phil-IRI manual](https://www.teacherph.com/phil-iri-manual-2018/) (not hardcoded guesses) |
| 5 | Comprehension grader (optional) | **Gemma 4 E2B** (or Gemma-SEA-LION-v4.5-E2B for Filipino) via Ollama | Grades a free-form spoken answer against the answer key | Gemma 4 Apache-2.0 ([Google](https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html)); SEA-LION E2B ([card](https://huggingface.co/aisingapore/Gemma-SEA-LION-v4.5-E2B-IT)) |
| 6 | Storage | SQLite | Zero setup, one file, works offline | Audio is **not stored** by default (privacy); setting to keep it for teacher review |

### 2.1 Real-time loop (one chunk)
```
mic frames ─► VAD detects pause (or 4 s max) ─► chunk ─► faster-whisper (word timestamps,
temperature 0, no previous-text conditioning) ─► heard words ─► Aligner updates pointer
─► emits {passage_index, status, heard_word, t} events ─► UI recolours words
```
- Cut chunks on pauses: children read slowly, word by word, so pauses are natural cut points.
- Cap chunks at about 4 s so marking never falls far behind.
- **Measure** chunk-to-colour latency on your own laptop and show it on stage. Don't quote a number you haven't measured.

### 2.2 Data model (SQLite)
```
learners(id, name, grade, section)
passages(id, set, grade, language, title, text, word_count, questions_json)
sessions(id, learner_id, passage_id, started_at, duration_s, wpm, accuracy,
         level, comp_score, teacher_edited BOOL)
word_marks(session_id, idx, passage_word, heard_word, status, t_start, t_end)
         -- status: correct | substitution | mispronunciation | omission | insertion | repetition
```

### 2.3 Alignment algorithm (the heart of Booklat)
Inputs: passage tokens `P[0..n]`, a stream of heard tokens `H`, and a pointer `p` (the next expected passage word).

1. **Normalise** both sides: lowercase, strip punctuation, collapse spaces. Keep `ng`/`nang`, `mga` etc. as-is. Optional: map digits to words.
2. For each heard word `h`, search the window `P[p .. p+3]` using a similarity score (normalised Levenshtein, e.g. `rapidfuzz.ratio`):
   - **Match at P[p]** with high similarity → `correct`, `p += 1`
   - **Partial similarity at P[p]** → `mispronunciation` (thresholds tuned in hour 1), `p += 1`
   - **Match at P[p+k]**, k ≥ 1 → `omission` for `P[p..p+k-1]`, `correct` for `P[p+k]`, `p += k+1`
   - **Matches an already-read word P[p-1] / P[p-2]** → `repetition` (no pointer move)
   - **No match** → if the next heard word matches `P[p+1]`, mark `P[p]` as `substitution`; otherwise mark `h` as `insertion`
3. On **Stop**, any remaining unread words are either *not reached* (the learner stopped) or omissions, at the teacher's choice.
4. The teacher's override taps rewrite `word_marks.status` and trigger a re-score.

> The miscue categories and which ones count against accuracy should follow the Phil-IRI manual. Keep them in `config.yaml` so you can match the manual exactly without code changes.

### 2.4 Scoring
```
reading_time_s   = last_word_t_end - first_word_t_start
wpm              = words_read_correctly / (reading_time_s / 60)
accuracy_pct     = (word_count - counted_miscues) / word_count * 100
reading_level    = lookup(accuracy_pct, comprehension_pct, thresholds from config)
```

### 2.5 API surface
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/passages` · `/api/learners` | Pickers |
| `POST` | `/api/sessions` | Start a session → `session_id` |
| `WS` | `/ws/read/{session_id}` | Client sends PCM frames; server sends word events |
| `POST` | `/api/sessions/{id}/stop` | Finalise and score |
| `PATCH` | `/api/sessions/{id}/words/{idx}` | Teacher override |
| `POST` | `/api/sessions/{id}/comprehension` | Audio answer → transcript + suggested grade |
| `GET` | `/api/export/class/{section}.csv` | Class reading profile |
| `GET` | `/api/health` | Shows models loaded + "network: none needed" |

### 2.6 Hardware target
- **Demo:** one laptop, 8–16 GB RAM, CPU only (a GPU is optional), Chrome.
- **Stretch:** the teacher's phone is the mic and screen, connected to the laptop's local hotspot (no internet, LAN only).

---

## 3. MVP scope (10-hour hackathon)

### Must have (the demo depends on it)
- [ ] 2 passages loaded (1 Filipino, 1 English, Grade 3 level) with word lists
- [ ] Live mic → VAD → faster-whisper → aligner → **words change colour live**
- [ ] Miscues detected: correct / substitution / omission / repetition (insertion if time allows)
- [ ] Results card: time, WPM, accuracy %, level
- [ ] Teacher tap-to-override
- [ ] Runs fully in **airplane mode**; a health endpoint shows models loaded locally

### Should have
- [ ] Learner roster + SQLite save + CSV export of the class profile
- [ ] Mispronunciation via partial similarity
- [ ] Latency readout (ms per chunk) in a corner of the UI, for the stage "local vs cloud" moment

### Nice to have (only if ahead of schedule)
- [ ] Spoken comprehension answers graded by Gemma 4 E2B
- [ ] Filipino-tuned speech model (`whisper-medium-ph`) toggle
- [ ] Phone as remote mic over local hotspot

### Out of scope (say so if judges ask)
- Accounts, cloud sync, the DepEd LIS integration
- Medical or diagnostic claims (e.g. dyslexia detection)
- Training our own model

---

## 4. 10-hour build plan (team of 3–4)

| Hour | Dev A: ML / back end | Dev B: aligner / scoring | Dev C: front end | Dev D: content / demo (or split) |
|---|---|---|---|---|
| **0–1** | Install faster-whisper + Silero; transcribe teammates reading **with deliberate errors**; pick model and settings | Write normalisation; tokenise 2 passages | Scaffold the Vite app; passage view with word spans | Type in passages and questions; record 5 test clips (clean, skip, repeat, substitute) |
| **1–3** | FastAPI WebSocket: receive PCM, VAD chunking, emit heard words | Aligner v1 against the recorded clips (unit tests) | Mic capture (AudioWorklet 16 kHz) → WebSocket | Draft the stage script; set up the network monitor |
| **3–5** | Wire the aligner into the WebSocket loop; word events out | Scorer + config thresholds from the manual | Live colouring + results card | Test the end-to-end flow with teammates; log bugs |
| **5–7** | Latency logging; model warm-up at start | Tune similarity thresholds on the test clips | Override taps; roster picker | SQLite + CSV export (pair with A) |
| **7–8** | *(Nice)* Gemma comprehension grader | Edge cases: child stops early, long pauses | Polish UI (big fonts, projector-friendly) | Slides: problem, demo, why local, architecture |
| **8–9** | **Feature freeze.** Full airplane-mode run ×3 | Fix only bugs found in runs | Fix only bugs found in runs | Rehearse the 2-minute demo with a timer |
| **9–10** | Buffer / backup video of a working run | Buffer | Buffer | Final rehearsal; prep judge Q&A |

**Hour-1 go/no-go:** if Whisper keeps "correcting" deliberately misread words to the passage word, try `temperature=0`, `condition_on_previous_text=False`, and **no** `initial_prompt` containing the passage. If it's still bad, switch to a CTC model (wav2vec2-style), which has less language-model bias. Decide by hour 1, not hour 6.

---

## 5. 2-minute demo (summary)
1. **Hook (15 s):** "Every year, teachers test struggling readers one by one with a stopwatch and paper."
2. **Prove offline (15 s):** airplane mode on camera; the network monitor shows 0 B/s.
3. **Wow (40 s):** a teammate reads with a skip, a substitution and a repeat; words turn colour live.
4. **Result (20 s):** WPM, accuracy and level appear, then the CSV row; the monitor still shows 0 bytes.
5. **Why local (20 s):** the latency readout, no signal needed, no child audio uploaded.
6. **Close (10 s):** "Phil-IRI in minutes, not an afternoon, and no child's voice leaves the room."

---

## 6. Risks and mitigations
| Risk | Mitigation |
|---|---|
| ASR auto-corrects the child's miscues | Hour-1 test; decoding settings; CTC fallback; the teacher override is always there |
| Accuracy on children's Filipino speech is unknown (**benchmark not found**) | Present Booklat as *teacher-assisted*, not autonomous; show the override |
| Noisy venue mic | Use a headset or lapel mic for the demo; VAD threshold tuning |
| Laptop too slow for `medium` | Default to `small`; warm up the model at start |
| Judges say "this exists" | "CoBRA showed it's feasible; Booklat is the offline, teacher-run, Phil-IRI-form version for no-signal schools" |

## 7. Suggested repo layout
```
booklat/
├─ server/
│  ├─ main.py            # FastAPI app, REST + WebSocket
│  ├─ asr.py             # faster-whisper wrapper + Silero VAD chunker
│  ├─ aligner.py         # incremental passage alignment
│  ├─ scorer.py          # WPM / accuracy / level
│  ├─ grader.py          # optional Gemma comprehension grader
│  ├─ db.py              # SQLite
│  └─ config.yaml        # miscue rules + level thresholds (from Phil-IRI manual)
├─ web/                  # Vite + React UI
├─ data/passages/*.json  # passage text + questions
└─ tests/test_aligner.py # recorded-clip expectations
```
