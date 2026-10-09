import sys
from types import ModuleType

from scripts import setup_speech


def test_setup_pins_source_and_publishes_only_complete_model(tmp_path, monkeypatch):
    destination = tmp_path / "models/whisper-medium-ph-ct2"
    monkeypatch.setattr(setup_speech, "MODEL_PATH", destination)
    hub = ModuleType("huggingface_hub")

    def snapshot_download(**kwargs):
        assert kwargs["repo_id"] == "rbcurzon/whisper-medium-ph"
        assert kwargs["revision"] == setup_speech.MODEL_REVISION
        assert "*.safetensors" in kwargs["allow_patterns"]
        return str(tmp_path / "source")

    hub.snapshot_download = snapshot_download
    converters = ModuleType("ctranslate2.converters")

    class Converter:
        def __init__(self, source, **kwargs):
            assert source == str(tmp_path / "source")
            assert kwargs["load_as_float16"] is True
            assert kwargs["low_cpu_mem_usage"] is True
            assert "tokenizer.json" in kwargs["copy_files"]

        def convert(self, output, **kwargs):
            from pathlib import Path

            assert not destination.exists()
            assert kwargs == {"quantization": "int8"}
            path = Path(output)
            path.mkdir()
            for name in setup_speech.MODEL_FILES:
                (path / name).write_bytes(b"fixture")

    converters.TransformersConverter = Converter
    monkeypatch.setitem(sys.modules, "huggingface_hub", hub)
    monkeypatch.setitem(sys.modules, "ctranslate2.converters", converters)
    setup_speech.main()
    assert all((destination / name).exists() for name in setup_speech.MODEL_FILES)
    hub.snapshot_download = lambda **kwargs: (_ for _ in ()).throw(AssertionError("downloaded twice"))
    setup_speech.main()
