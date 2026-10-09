"""Local, CPU-only speech recognition. Audio is decoded in memory and never saved."""

import os
from importlib.util import find_spec
from io import BytesIO
from pathlib import Path
from threading import Lock

from server.schemas import Transcription, TranscriptionWord

# The bundled VAD must not create telemetry uploaders or persistent device IDs.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "rbcurzon/whisper-medium-ph"
MODEL_REVISION = "78c8f3e722ed5409eeb7c0b205bb3bf370cc19f5"
MODEL_PATH = ROOT / "models/whisper-medium-ph-ct2"
SAMPLE_RATE = 16_000
MAX_SECONDS = 120
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json", "preprocessor_config.json")


class SpeechUnavailable(RuntimeError):
    pass


class SpeechBusy(RuntimeError):
    pass


def availability_error() -> str | None:
    if find_spec("faster_whisper") is None:
        return "Speech dependencies are missing. Run npm run speech:setup."
    if not all((MODEL_PATH / name).is_file() for name in MODEL_FILES):
        return "The local speech model is missing. Run npm run speech:setup."
    return None


def decode_audio(data: bytes):
    """Bound decoded audio too: a small compressed file can contain hours of audio."""
    import av
    import numpy as np

    frames = []
    samples = 0
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    try:
        # Block playlists from opening external URLs or local files.
        with av.open(BytesIO(data), options={"protocol_whitelist": "pipe"}) as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise ValueError("The file has no audio track.")
            for frame in container.decode(stream):
                # Container timestamps may be absent or discontinuous.
                frame.pts = None
                for converted in resampler.resample(frame):
                    samples += converted.samples
                    if samples > MAX_SECONDS * SAMPLE_RATE:
                        raise ValueError(f"Recordings must be {MAX_SECONDS} seconds or shorter.")
                    frames.append(converted.to_ndarray().reshape(-1))
            for converted in resampler.resample(None):
                samples += converted.samples
                if samples > MAX_SECONDS * SAMPLE_RATE:
                    raise ValueError(f"Recordings must be {MAX_SECONDS} seconds or shorter.")
                frames.append(converted.to_ndarray().reshape(-1))
    except av.error.FFmpegError as error:
        raise ValueError("Audio could not be decoded. Use WAV, WebM, MP4, or Ogg.") from error
    if not samples:
        raise ValueError("The recording contains no audio samples.")
    return np.concatenate(frames).astype(np.float32) / 32768.0


class SpeechRecognizer:
    def __init__(self):
        self.model = None
        self.lock = Lock()

    def transcribe(self, data: bytes, language: str) -> Transcription:
        if not self.lock.acquire(blocking=False):
            raise SpeechBusy("Speech recognition is busy. Try again when it finishes.")
        try:
            error = availability_error()
            if error:
                raise SpeechUnavailable(error)
            audio = decode_audio(data)
            if self.model is None:
                try:
                    import onnxruntime

                    onnxruntime.disable_telemetry_events()
                    from faster_whisper import WhisperModel

                    self.model = WhisperModel(
                        str(MODEL_PATH), device="cpu", compute_type="int8",
                        cpu_threads=2, local_files_only=True,
                    )
                except Exception as error:
                    raise SpeechUnavailable("The local speech model could not be loaded.") from error
            segments, info = self.model.transcribe(
                audio, language="tl" if language == "fil" else "en", task="transcribe",
                temperature=0, condition_on_previous_text=False, word_timestamps=True,
                vad_filter=True, vad_parameters={"min_silence_duration_ms": 500},
            )
            # Iterate inside the lock: faster-whisper performs inference lazily.
            segments = list(segments)
            words = [
                TranscriptionWord(
                    word=word.word.strip(), start=word.start, end=word.end,
                    probability=word.probability,
                )
                for segment in segments for word in (segment.words or [])
            ]
            return Transcription(
                text=" ".join(segment.text.strip() for segment in segments).strip(),
                language=info.language, duration_s=len(audio) / SAMPLE_RATE,
                model=MODEL_ID, words=words,
            )
        finally:
            self.lock.release()


recognizer = SpeechRecognizer()
