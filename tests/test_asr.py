import os
import sys
import wave
from io import BytesIO
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from server import asr
from server.main import app


def wav(samples=1600, rate=16000, channels=1):
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x00" * samples * channels)
    return output.getvalue()


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize(("language", "whisper_language"), [("fil", "tl"), ("en", "en")])
def test_transcription_words_and_decoding_options(client, monkeypatch, language, whisper_language):
    recognizer = asr.SpeechRecognizer()

    class Model:
        def transcribe(self, audio, **options):
            assert options == {
                "language": whisper_language, "task": "transcribe", "temperature": 0,
                "condition_on_previous_text": False, "word_timestamps": True,
                "vad_filter": True, "vad_parameters": {"min_silence_duration_ms": 500},
            }

            def segments():
                assert recognizer.lock.locked()
                yield SimpleNamespace(text=" May aklat.", words=[
                    SimpleNamespace(word=" May", start=0.1, end=0.4, probability=0.9),
                    SimpleNamespace(word=" aklat.", start=0.4, end=0.8, probability=0.8),
                ])
                yield SimpleNamespace(text="Ito.", words=None)

            return segments(), SimpleNamespace(language=whisper_language)

    recognizer.model = Model()
    monkeypatch.setattr(asr, "recognizer", recognizer)
    monkeypatch.setattr(asr, "availability_error", lambda: None)
    monkeypatch.setattr(asr, "decode_audio", lambda data: [0.0] * 16000)
    response = client.post(f"/api/transcribe?language={language}", content=wav())
    assert response.status_code == 200
    assert response.json() == {
        "text": "May aklat. Ito.", "language": whisper_language, "duration_s": 1.0,
        "model": asr.MODEL_ID,
        "words": [
            {"word": "May", "start": 0.1, "end": 0.4, "probability": 0.9},
            {"word": "aklat.", "start": 0.4, "end": 0.8, "probability": 0.8},
        ],
    }
    assert not recognizer.lock.locked()


def test_audio_validation_and_busy_response(client, monkeypatch):
    monkeypatch.setattr(asr, "availability_error", lambda: None)
    monkeypatch.setattr(asr, "MAX_UPLOAD_BYTES", 8)
    assert client.post("/api/transcribe", content=b"").status_code == 422
    assert client.post("/api/transcribe", content=b"123456789").status_code == 413
    assert client.post("/api/transcribe?language=invalid", content=b"x").status_code == 422
    recognizer = asr.SpeechRecognizer()
    monkeypatch.setattr(asr, "recognizer", recognizer)
    recognizer.lock.acquire()
    try:
        assert client.post("/api/transcribe", content=b"x").status_code == 409
    finally:
        recognizer.lock.release()

    def invalid_audio(data):
        raise ValueError("Invalid audio")

    monkeypatch.setattr(asr, "decode_audio", invalid_audio)
    assert client.post("/api/transcribe", content=b"x").status_code == 422
    assert not recognizer.lock.locked()


def test_missing_model_never_falls_back_to_demo(client, monkeypatch):
    monkeypatch.setattr(asr, "availability_error", lambda: "Local model missing")
    health = client.get("/api/health").json()
    assert health["speech_available"] is False
    assert health["speech_error"] == "Local model missing"
    response = client.post("/api/transcribe", content=wav())
    assert response.status_code == 503
    assert response.json()["detail"] == "Local model missing"


def test_model_load_is_local_once_and_telemetry_is_disabled(monkeypatch):
    calls = []
    ort = ModuleType("onnxruntime")
    ort.disable_telemetry_events = lambda: calls.append("telemetry disabled")
    whisper = ModuleType("faster_whisper")

    class Model:
        def __init__(self, path, **options):
            assert os.environ["ORT_DISABLE_TELEMETRY"] == "1"
            assert calls == ["telemetry disabled"]
            assert path == str(asr.MODEL_PATH)
            assert options == {
                "device": "cpu", "compute_type": "int8",
                "cpu_threads": 2, "local_files_only": True,
            }
            calls.append("model loaded")

        def transcribe(self, *args, **kwargs):
            return iter(()), SimpleNamespace(language="tl")

    whisper.WhisperModel = Model
    monkeypatch.setitem(sys.modules, "onnxruntime", ort)
    monkeypatch.setitem(sys.modules, "faster_whisper", whisper)
    monkeypatch.setattr(asr, "availability_error", lambda: None)
    monkeypatch.setattr(asr, "decode_audio", lambda data: [0.0])
    recognizer = asr.SpeechRecognizer()
    for _ in range(2):
        result = recognizer.transcribe(b"audio", "fil")
        assert result.text == "" and result.words == []
    assert calls == ["telemetry disabled", "model loaded"]


def test_lazy_inference_failure_releases_lock(monkeypatch):
    recognizer = asr.SpeechRecognizer()

    class BrokenModel:
        def transcribe(self, *args, **kwargs):
            def segments():
                raise RuntimeError("inference failed")
                yield
            return segments(), SimpleNamespace(language="tl")

    recognizer.model = BrokenModel()
    monkeypatch.setattr(asr, "availability_error", lambda: None)
    monkeypatch.setattr(asr, "decode_audio", lambda data: [0.0])
    with pytest.raises(RuntimeError, match="inference failed"):
        recognizer.transcribe(b"audio", "fil")
    assert not recognizer.lock.locked()


def test_decoder_resamples_stereo_and_bounds_duration(monkeypatch):
    pytest.importorskip("av")
    pytest.importorskip("numpy")
    audio = asr.decode_audio(wav(samples=4800, rate=48000, channels=2))
    assert len(audio) == 1600
    assert audio.dtype.name == "float32"
    with pytest.raises(ValueError, match="decoded"):
        asr.decode_audio(b"not audio")
    with pytest.raises(ValueError, match="no audio samples"):
        asr.decode_audio(wav(samples=0))
    monkeypatch.setattr(asr, "MAX_SECONDS", 0)
    with pytest.raises(ValueError, match="seconds or shorter"):
        asr.decode_audio(wav())
