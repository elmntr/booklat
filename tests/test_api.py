import pytest
from fastapi.testclient import TestClient

from server.main import app
from server.schemas import WordEvent


@pytest.fixture
def client():
    app.state.sessions.clear()
    app.state.started.clear()
    app.state.streaming.clear()
    with TestClient(app) as client:
        yield client


def start(client):
    response = client.post(
        "/api/sessions",
        json={
            "learner_id": "demo-learner",
            "passage_id": "en-demo",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_full_reading_and_override(client):
    assert client.get("/api/health").json()["models_loaded"] is False
    passage = client.get("/api/passages").json()[0]
    session_id = start(client)
    with client.websocket_connect(f"/ws/read/{session_id}") as ws:
        events = [WordEvent.model_validate(ws.receive_json()) for _ in passage["words"]]
    assert [e.passage_index for e in events] == list(range(len(passage["words"])))
    assert all(e.session_id == session_id for e in events)
    stopped = client.post(f"/api/sessions/{session_id}/stop").json()
    assert stopped["state"] == "stopped"
    assert stopped["level"] is None
    assert stopped["duration_s"] > 0
    assert client.post(f"/api/sessions/{session_id}/stop").json() == stopped
    edited = client.patch(f"/api/sessions/{session_id}/words/2", json={"status": "correct"})
    assert edited.status_code == 200
    assert edited.json()["teacher_edited"] is True
    assert edited.json()["marks"][2]["status"] == "correct"
    assert client.get(f"/api/sessions/{session_id}").json() == edited.json()


def test_invalid_resources_and_lifecycle(client):
    assert (
        client.post(
            "/api/sessions",
            json={
                "learner_id": "missing",
                "passage_id": "en-demo",
            },
        ).status_code
        == 404
    )
    assert client.get("/api/sessions/missing").status_code == 404
    session_id = start(client)
    assert (
        client.patch(
            f"/api/sessions/{session_id}/words/0",
            json={
                "status": "correct",
            },
        ).status_code
        == 409
    )
    client.post(f"/api/sessions/{session_id}/stop")
    assert (
        client.patch(
            f"/api/sessions/{session_id}/words/900",
            json={
                "status": "correct",
            },
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/sessions/{session_id}/words/0",
            json={
                "status": "invalid",
            },
        ).status_code
        == 422
    )


def test_early_stop_does_not_mark_remaining_words(client):
    session_id = start(client)
    with client.websocket_connect(f"/ws/read/{session_id}") as ws:
        ws.receive_json()
        stopped = client.post(f"/api/sessions/{session_id}/stop").json()
        from starlette.websockets import WebSocketDisconnect

        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert len(stopped["marks"]) == 1
    assert client.get(f"/api/sessions/{session_id}").json()["marks"] == stopped["marks"]
