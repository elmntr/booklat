"""Integration scaffold. Synthetic words only; no microphone or ASR yet."""

import asyncio
import json
from pathlib import Path
from time import monotonic
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

from server.schemas import (
    Health,
    Learner,
    MarkOverride,
    Passage,
    Session,
    StartSession,
    WordEvent,
    WordMark,
)

ROOT = Path(__file__).resolve().parents[1]
PASSAGES = [
    Passage(**p, words=p["text"].split())
    for p in json.loads((ROOT / "data/passages/demo.json").read_text())
]
LEARNERS = [Learner(id="demo-learner", name="Demo learner", grade=3, section="Demo")]
app = FastAPI(title="Booklat local API", version="0.1.0")
# Deliberately transient until the backend owner adds SQLite.
app.state.sessions = {}
app.state.started = {}
app.state.streaming = set()


def get_session(session_id: str) -> Session:
    session = app.state.sessions.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found")
    return session


@app.get("/api/health", response_model=Health)
def health():
    return Health()


@app.get("/api/learners", response_model=list[Learner])
def learners():
    return LEARNERS


@app.get("/api/passages", response_model=list[Passage])
def passages():
    return PASSAGES


@app.post("/api/sessions", response_model=Session, status_code=201)
def start_session(body: StartSession):
    if body.learner_id not in {x.id for x in LEARNERS}:
        raise HTTPException(404, "Learner not found")
    if body.passage_id not in {x.id for x in PASSAGES}:
        raise HTTPException(404, "Passage not found")
    session = Session(id=str(uuid4()), marks=[], **body.model_dump())
    app.state.sessions[session.id] = session
    app.state.started[session.id] = monotonic()
    return session


@app.get("/api/sessions/{session_id}", response_model=Session)
def read_session(session_id: str):
    return get_session(session_id)


@app.post("/api/sessions/{session_id}/stop", response_model=Session)
def stop_session(session_id: str):
    session = get_session(session_id)
    if session.state == "active":
        session.state = "stopped"
        session.duration_s = round(monotonic() - app.state.started[session_id], 3)
    return session


@app.patch("/api/sessions/{session_id}/words/{idx}", response_model=Session)
def override_word(session_id: str, idx: int, body: MarkOverride):
    session = get_session(session_id)
    if session.state != "stopped":
        raise HTTPException(409, "Stop the demo before editing marks")
    mark = next((m for m in session.marks if m.passage_index == idx), None)
    if mark is None:
        raise HTTPException(404, "Word has not been marked")
    mark.status = body.status
    session.teacher_edited = True
    return session


@app.websocket("/ws/read/{session_id}")
async def read_stream(ws: WebSocket, session_id: str):
    session = app.state.sessions.get(session_id)
    if session is None or session.state != "active" or session_id in app.state.streaming:
        await ws.close(code=1008)
        return
    await ws.accept()
    app.state.streaming.add(session_id)
    passage = next(p for p in PASSAGES if p.id == session.passage_id)
    try:
        for idx in range(len(session.marks), len(passage.words)):
            await asyncio.sleep(0.25)
            if session.state != "active":
                break
            mark = WordMark(
                passage_index=idx,
                status="substitution" if idx == 2 else "correct",
                heard_word="example" if idx == 2 else passage.words[idx],
                t=idx * 0.25,
            )
            session.marks.append(mark)
            await ws.send_json(WordEvent(session_id=session_id, **mark.model_dump()).model_dump())
        await ws.close(code=1000)
    except WebSocketDisconnect:
        pass
    finally:
        app.state.streaming.discard(session_id)
