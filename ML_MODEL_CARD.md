# CrowdPulse ML Model Card: v1

## What was trained
The first real CrowdPulse ML model is an **XGBoost regression model that forecasts the next hourly pedestrian count for the same street**.

It is NOT an emergency/stampede classifier and its output must not be described as an emergency probability.

## Training data
- Dataset: Würzburg Foot Traffic
- Source: https://www.kaggle.com/competitions/foot-traffic-wue/data
- Input supplied for this training run: `train.csv` (82,821 rows, 13 columns)
- Targets: `n_pedestrians` at the next hour, within the same street series.

## Leakage prevention
Rows are ordered by street/date/hour. Features use only current and past observations. The split is chronological:
- Train: first 70% of available dates
- Validation: next 15%
- Test: final 15%

The test period was not used to fit the final deployed artifact.

## Models evaluated
For this first production-oriented run, XGBoost and LightGBM were compared. XGBoost was selected because it had lower held-out test RMSE and MAE.

### Held-out test results
| Model | MAE | RMSE | R² | sMAPE |
|---|---:|---:|---:|---:|
| XGBoost | 72.79 | 126.08 | 0.9834 | 19.19% |
| LightGBM | 74.16 | 126.85 | 0.9832 | 20.37% |
| Naive current-count baseline | 195.69 | 303.72 | 0.9037 | 44.14% |

The naive baseline is simply `next_count = current_count`.

## Deployment artifact
`ai-service/models/wuerzburg_flow_xgb.joblib`

Metadata and training provenance:
`ai-service/models/model_metadata.json`

Reproducible training script:
`training/train_wuerzburg_flow.py`

## Integration
The model is exposed by the AI service at `POST /flow-forecast` and by the authenticated backend at `POST /api/ai/flow-forecast`.

The request requires at least 169 hourly observations because the model uses a one-week (168-hour) lag. This endpoint is intentionally separate from the existing prototype emergency-risk endpoint.

## Critical limitations
1. Würzburg street-counter counts are not equivalent to a 10m² venue camera's instantaneous occupancy.
2. This model predicts pedestrian flow, not crowd danger, panic, stampede, or emergency probability.
3. Before operational use at a venue, the model should be calibrated/retrained with venue-specific hourly flow data.
4. The test metrics are an in-dataset temporal holdout, not an external-site generalization test.
5. Weather and incident fields available at prediction time must be supplied accurately; future values cannot be assumed unless they are genuinely known.
