"""Shared contract source. Regenerate clients with npm run contract after changes."""

from typing import Literal

from pydantic import BaseModel, Field


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    mode: Literal["demo"] = "demo"
    models_loaded: bool = False
    network_required: bool = False


class Learner(BaseModel):
    id: str
    name: str
    grade: int
    section: str


class Passage(BaseModel):
    id: str
    title: str
    language: Literal["en", "fil"]
    grade: int
    text: str
    source: str
    words: list[str]


class StartSession(BaseModel):
    learner_id: str
    passage_id: str


MarkStatus = Literal["correct", "substitution", "mispronunciation", "omission", "repetition"]


class WordMark(BaseModel):
    passage_index: int = Field(ge=0)
    status: MarkStatus
    heard_word: str | None = None
    t: float = Field(ge=0)


class WordEvent(WordMark):
    type: Literal["word"] = "word"
    session_id: str


class MarkOverride(BaseModel):
    status: MarkStatus


class Session(BaseModel):
    id: str
    learner_id: str
    passage_id: str
    state: Literal["active", "stopped"] = "active"
    mode: Literal["demo"] = "demo"
    marks: list[WordMark]
    teacher_edited: bool = False
    duration_s: float = 0
    # Official metrics await validated scoring rules and real audio timestamps.
    wpm: float | None = None
    accuracy_pct: float | None = None
    level: str | None = None
