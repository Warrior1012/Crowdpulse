# CrowdPulse AI Architecture

CrowdPulse now uses a hybrid AI stack instead of sending every camera frame to an LLM.

## 1. Vision
YOLOv8 detects people in camera frames. It emits a count every configured interval.

## 2. Local predictive AI
`ai-service` runs a local `GradientBoostingClassifier` for near-term crowd-risk probability and an `IsolationForest` for unusual feature patterns. It uses occupancy, inflow, outflow, acceleration and corroborated panic reports.

The bootstrap model is deterministic and domain-shaped so the prototype works before a real venue has enough historical labels. It is explicitly not a production-trained crowd model. When you collect real incident labels, retrain the classifier with venue-specific data.

## 3. Venue-aware retrieval
PostgreSQL stores `venue_knowledge` entries covering zone SOPs, exits, responder constraints and operational rules. The Node AI layer retrieves relevant entries and supplies them as grounded context.

## 4. Gemini reasoning (optional)
Set `GEMINI_API_KEY` to enable Gemini reasoning. Gemini receives aggregated structured state and venue knowledge, not raw camera frames. It returns a concise operational summary, reasons, recommended human-approval actions and caveats.

If the key is missing or Gemini is unavailable, CrowdPulse falls back to the local deterministic copilot. The system remains functional.

## 5. Safety boundary
AI recommendations are advisory. The deterministic CrowdPulse threshold/dispatch logic remains authoritative. Do not wire an LLM directly to gates, evacuation controls or other safety-critical actuators.

## Event flow
Camera -> YOLO -> sensor-ping -> PostgreSQL -> local AI service -> venue retrieval -> optional Gemini -> Redis Pub/Sub -> Socket.IO -> dashboard.
