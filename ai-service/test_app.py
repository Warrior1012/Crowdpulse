"""Smoke tests for the FastAPI AI service and committed model artifacts.

Run from the repository root with:
  pip install -r ai-service/requirements.txt httpx
  python ai-service/test_app.py
"""
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

health = client.get("/health")
assert health.status_code == 200, health.text
health_data = health.json()
assert health_data.get("ok") is True, health_data
assert health_data.get("anomalyModelLoaded") is True, health_data

# Invalid prediction inputs should be rejected as client errors, not server errors.
invalid_numeric = client.post("/predict", json={"count": "not-a-number"})
assert invalid_numeric.status_code == 422, invalid_numeric.text

invalid_constraints = client.post("/predict", json={"count": -1, "capacity": 10})
assert invalid_constraints.status_code == 422, invalid_constraints.text

flow_health = client.get("/flow-model/health")
assert flow_health.status_code == 200, flow_health.text
flow_data = flow_health.json()
assert flow_data.get("loaded") is True, flow_data

start = datetime(2025, 1, 1)
history = []
for i in range(169):
    stamp = start + timedelta(hours=i)
    count = 25 + (i % 24) * 3 + (i % 7)
    history.append({
        "date": stamp.strftime("%Y-%m-%d"),
        "hour": stamp.hour,
        "weekday": stamp.strftime("%A"),
        "n_pedestrians": count,
        "n_pedestrians_towards": count * 0.6,
        "n_pedestrians_away": count * 0.4,
        "temperature": 10.0,
        "weather_condition": "clear",
        "incidents": "no_incident",
        "collection_type": "measured",
    })

prediction = client.post(
    "/flow-forecast",
    json={"streetname": "Smoke Test Street", "history": history},
)
assert prediction.status_code == 200, prediction.text
prediction_data = prediction.json()
assert prediction_data.get("available") is True, prediction_data
assert isinstance(prediction_data.get("forecastNextHour"), (int, float)), prediction_data

print("AI smoke tests passed: health, model artifacts, and next-hour flow forecast.")
