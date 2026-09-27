# CrowdPulse AI Model Upgrade: v2.2

## What changed
- Removed the synthetic/bootstrap supervised risk classifier from the AI service.
- Added a real-data next-hour crowd-surge classifier trained on the uploaded Würzburg Foot Traffic dataset.
- Surge labels are derived from the 90th percentile of next-hour count increase in the training period only; the threshold is learned from data, not hardcoded.
- Added a real-data Isolation Forest trained on normal training-period crowd dynamics.
- Anomaly score is calibrated from training-set decision-function quantiles instead of an arbitrary multiplier.
- Kept the existing Würzburg next-hour count forecaster.
- Kept Gemini as an optional reasoning layer; Gemini receives structured model output and venue knowledge rather than raw camera frames.

## Held-out results
Short-history surge model (chronological 70/15/15 split):
- Validation ROC-AUC: 0.9680
- Validation PR-AUC: 0.7572
- Validation F1 @ 0.5: 0.5942
- Test ROC-AUC: 0.9706
- Test PR-AUC: 0.7771
- Test F1 @ 0.5: 0.6370
- Test precision: 0.4950
- Test recall: 0.8933

## Important interpretation
This model forecasts a **rapid next-hour increase in pedestrian count**. It is NOT trained on emergency/stampede labels and must not be represented as such.

The API keeps `risk` as a backward-compatible alias for the learned `surgeScore`; the response also explicitly identifies the target.

## Remaining gap
True emergency/stampede prediction requires venue-specific labeled incident sequences or a carefully designed weak/self-supervised target validated against real incidents. The current architecture deliberately does not invent those labels.
