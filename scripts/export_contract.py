"""Export REST OpenAPI and a separately versioned WebSocket event schema."""

import json
from pathlib import Path

from server.main import app
from server.schemas import WordEvent

root = Path(__file__).resolve().parents[1] / "contracts"
for name, schema in [
    ("openapi.json", app.openapi()),
    ("word-event.schema.json", WordEvent.model_json_schema()),
]:
    (root / name).write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
