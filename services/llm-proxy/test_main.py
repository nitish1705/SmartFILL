import json

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)

BODY = {
    "fields": [
        {
            "field_id": "f1",
            "label": "Name of affiliated institution",
            "placeholder": "",
            "section": "Author Information",
            "page_title": "Paper Submission",
            "candidate_keys": ["academic.institution", "professional.organization"],
        }
    ]
}


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    main._hits.clear()
    monkeypatch.setattr(main, "SHARED_TOKEN", None)
    monkeypatch.setattr(main, "RATE_LIMIT", 30)


def fake_model(monkeypatch, answer):
    monkeypatch.setattr(main, "ask_model", lambda payload: answer if isinstance(answer, str) else json.dumps(answer))


def test_valid_answer_is_returned(monkeypatch):
    fake_model(monkeypatch, {"results": [{"field_id": "f1", "matched_profile_key": "academic.institution", "confidence": 0.94, "reason": "asks for affiliation"}]})
    r = client.post("/map-fields", json=BODY)
    assert r.status_code == 200
    assert r.json()["results"][0]["matched_profile_key"] == "academic.institution"


def test_key_outside_candidates_is_dropped(monkeypatch):
    fake_model(monkeypatch, {"results": [{"field_id": "f1", "matched_profile_key": "personal.email", "confidence": 0.9}]})
    assert client.post("/map-fields", json=BODY).json()["results"] == []


def test_unknown_field_and_garbage_are_dropped(monkeypatch):
    fake_model(monkeypatch, {"results": [{"field_id": "zzz", "matched_profile_key": None, "confidence": 1}]})
    assert client.post("/map-fields", json=BODY).json()["results"] == []
    fake_model(monkeypatch, "I think it is the institution")
    assert client.post("/map-fields", json=BODY).json()["results"] == []


def test_json_wrapped_in_prose_is_still_parsed(monkeypatch):
    fake_model(monkeypatch, 'Sure!\n{"results":[{"field_id":"f1","matched_profile_key":null,"confidence":0.2}]}')
    assert client.post("/map-fields", json=BODY).json()["results"][0]["matched_profile_key"] is None


def test_rejects_invalid_and_oversized_requests(monkeypatch):
    fake_model(monkeypatch, {"results": []})
    assert client.post("/map-fields", json={"fields": []}).status_code == 422
    assert client.post("/map-fields", json={"nope": 1}).status_code == 422
    monkeypatch.setattr(main, "MAX_BODY_BYTES", 50)
    assert client.post("/map-fields", json=BODY).status_code == 413


def test_rate_limit(monkeypatch):
    fake_model(monkeypatch, {"results": []})
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    codes = [client.post("/map-fields", json=BODY).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_token_required_when_configured(monkeypatch):
    fake_model(monkeypatch, {"results": []})
    monkeypatch.setattr(main, "SHARED_TOKEN", "s3cret")
    assert client.post("/map-fields", json=BODY).status_code == 401
    assert client.post("/map-fields", json=BODY, headers={"x-smartfill-token": "s3cret"}).status_code == 200


def test_upstream_errors_do_not_leak(monkeypatch):
    def boom(payload):
        raise RuntimeError("secret detail: Name of affiliated institution")

    monkeypatch.setattr(main, "ask_model", boom)
    r = client.post("/map-fields", json=BODY)
    assert r.status_code == 502
    assert "secret" not in r.text and "institution" not in r.text
