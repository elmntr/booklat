"""Local speech transcription and the separately labelled synthetic reading demo."""

import asyncio
import json
from pathlib import Path
from time import monotonic
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from server import asr
from server.schemas import (
    Health,
    Learner,
    MarkOverride,
    Passage,
    Session,
    StartSession,
    Transcription,
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
    error = asr.availability_error()
    return Health(
        models_loaded=asr.recognizer.model is not None,
        speech_available=error is None, speech_error=error,
    )


@app.post(
    "/api/transcribe", response_model=Transcription,
    openapi_extra={"requestBody": {
        "required": True,
        "content": {"application/octet-stream": {
            "schema": {"type": "string", "format": "binary"},
        }},
    }},
)
async def transcribe(request: Request, language: Literal["en", "fil"] = "fil"):
    """Accept encoded audio, never store it, and return words with audio timestamps."""
    if error := asr.availability_error():
        raise HTTPException(503, error)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > asr.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Audio upload exceeds 10 MiB.")
        data.extend(chunk)
    if not data:
        raise HTTPException(422, "The recording is empty.")
    try:
        return await run_in_threadpool(asr.recognizer.transcribe, bytes(data), language)
    except asr.SpeechUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except asr.SpeechBusy as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


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
