"""Download the requested model once, then convert it for offline CPU inference."""

from pathlib import Path
from tempfile import TemporaryDirectory

from server.asr import MODEL_FILES, MODEL_ID, MODEL_PATH, MODEL_REVISION


def main():
    if all((MODEL_PATH / name).is_file() for name in MODEL_FILES):
        print(f"Speech model already prepared: {MODEL_PATH}")
        return
    if MODEL_PATH.exists():
        raise SystemExit(f"Incomplete model at {MODEL_PATH}; move it aside before retrying.")

    from ctranslate2.converters import TransformersConverter
    from huggingface_hub import snapshot_download

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {MODEL_ID}@{MODEL_REVISION}; source weights are about 3.06 GB.", flush=True)
    source = snapshot_download(
        repo_id=MODEL_ID, revision=MODEL_REVISION,
        cache_dir=str(MODEL_PATH.parent / "hub"),
        allow_patterns=["*.json", "*.safetensors", "merges.txt", "vocab.json"],
    )
    print("Converting to CTranslate2 int8 for CPU inference…", flush=True)
    with TemporaryDirectory(prefix="convert-", dir=MODEL_PATH.parent) as directory:
        output = Path(directory) / "model"
        TransformersConverter(
            source, copy_files=["tokenizer.json", "preprocessor_config.json"],
            load_as_float16=True, low_cpu_mem_usage=True,
        ).convert(str(output), quantization="int8")
        if not all((output / name).is_file() for name in MODEL_FILES):
            raise SystemExit("Conversion did not produce all required model files.")
        output.rename(MODEL_PATH)
    print(f"Offline speech model ready: {MODEL_PATH}")


if __name__ == "__main__":
    main()
