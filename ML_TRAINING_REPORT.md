# ML Training Report

Training completed from the uploaded `train.csv`.

- Rows: 82,821
- Columns: 13
- Target: next-hour `n_pedestrians`
- Selected model: XGBoost regressor
- Validation split: chronological
- Final test split: chronological and held out

The model beat the naive current-count baseline on the held-out test set:

- MAE: 72.79 vs 195.69
- RMSE: 126.08 vs 303.72
- R²: 0.9834 vs 0.9037
- sMAPE: 19.19% vs 44.14%

These results establish that the trained model learned useful short-term flow patterns in this dataset. They do **not** establish that it predicts crowd emergencies at the user's venue.
