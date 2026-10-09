"""Check generated files without modifying them; also works before the first commit."""

import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

from server.main import app
from server.schemas import WordEvent

ROOT = Path(__file__).resolve().parents[1]


def main():
    expected = {
        "contracts/openapi.json": app.openapi(),
        "contracts/word-event.schema.json": WordEvent.model_json_schema(),
    }
    for name, schema in expected.items():
        if (ROOT / name).read_text() != json.dumps(schema, indent=2, sort_keys=True) + "\n":
            raise SystemExit(f"{name} is stale. Run npm run contract.")
    with TemporaryDirectory() as directory:
        output = Path(directory) / "api.generated.ts"
        subprocess.run(
            [
                "node",
                str(ROOT / "node_modules/openapi-typescript/bin/cli.js"),
                str(ROOT / "contracts/openapi.json"),
                "-o",
                str(output),
            ],
            check=True,
        )
        if output.read_text() != (ROOT / "web/src/api.generated.ts").read_text():
            raise SystemExit("TypeScript client is stale. Run npm run contract.")
    print("REST and WebSocket contracts match; TypeScript client is up to date.")


if __name__ == "__main__":
    main()
