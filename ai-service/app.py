from fastapi import FastAPI, Body
from pydantic import BaseModel, Field
import numpy as np

app = FastAPI(title='CrowdPulse Local AI', version='1.0.0')

# --- Real-data dynamics models --------------------------------------------
# No synthetic labels are used here. The surge target is derived from the
# measured Würzburg time series using a threshold learned from the training
# period only. The anomaly model is fit on normal training-period dynamics.
import os as _os
import json as _json
import joblib as _joblib
import pandas as _pd

_SURGE_PATH = _os.path.join(_os.path.dirname(__file__), 'models', 'wuerzburg_short_history_surge_xgb.joblib')
_ANOM_PATH = _os.path.join(_os.path.dirname(__file__), 'models', 'wuerzburg_short_history_isolation_forest.joblib')
_SURGE_META = _os.path.join(_os.path.dirname(__file__), 'models', 'wuerzburg_short_history_metadata.json')
_ANOM_META = _os.path.join(_os.path.dirname(__file__), 'models', 'wuerzburg_short_history_anomaly_metadata.json')
SURGE_MODEL = _joblib.load(_SURGE_PATH) if _os.path.exists(_SURGE_PATH) else None
ANOM_MODEL = _joblib.load(_ANOM_PATH) if _os.path.exists(_ANOM_PATH) else None
SURGE_META = _json.load(open(_SURGE_META)) if _os.path.exists(_SURGE_META) else {}
ANOM_META = _json.load(open(_ANOM_META)) if _os.path.exists(_ANOM_META) else {}
SURGE_VERSION = 'WuerzburgNextHourSurge-XGBoost-v2.1'

class Features(BaseModel):
    count: float = Field(ge=0)
    capacity: float = Field(gt=0)
    occupancy: float = Field(ge=0)
    inflowRate: float = Field(ge=0)
    outflowRate: float = Field(ge=0)
    acceleration: float = 0
    panicReports: float = Field(ge=0)
    intervalSeconds: float = Field(gt=0)
    anomalyHint: float = Field(default=0, ge=0, le=1)
    source: str = 'unknown'
    zoneId: str = 'unknown'
    history: list[float] = Field(default_factory=list, max_length=64)
    temperature: float = 0
    weather_condition: str = 'unknown'
    incidents: str = 'no_incident'


def _coerce_float_list(value):
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    out = []
    for item in value:
        try:
            num = float(item)
        except (TypeError, ValueError):
            continue
        if np.isfinite(num):
            out.append(num)
    return out


def _normalize_prediction_payload(payload):
    if isinstance(payload, Features):
        return payload
    if payload is None:
        raise ValueError('AI prediction payload is required')
    if not isinstance(payload, dict):
        raise TypeError('AI prediction payload must be an object')

    history = _coerce_float_list(payload.get('history'))
    if not history and 'counts' in payload:
        history = _coerce_float_list(payload.get('counts'))

    count = float(payload.get('count', payload.get('currentCount', 0.0)))
    capacity = float(payload.get('capacity', payload.get('cap', max(count, 1.0))))
    if capacity <= 0:
        capacity = max(count, 1.0)

    occupancy = float(payload.get('occupancy', (count / capacity) if capacity else 0.0))
    inflow = float(payload.get('inflowRate', payload.get('inflow_rate', 0.0)))
    outflow = float(payload.get('outflowRate', payload.get('outflow_rate', 0.0)))
    if inflow == 0 and outflow == 0 and len(history) >= 2:
        previous = float(history[-2])
        inflow = max(0.0, count - previous)
        outflow = max(0.0, previous - count)

    return Features(
        count=count,
        capacity=capacity,
        occupancy=occupancy,
        inflowRate=inflow,
        outflowRate=outflow,
        acceleration=float(payload.get('acceleration', payload.get('accel', 0.0))),
        panicReports=float(payload.get('panicReports', payload.get('panicCount', 0.0))),
        intervalSeconds=float(payload.get('intervalSeconds', payload.get('interval_seconds', 2.0))),
        anomalyHint=float(payload.get('anomalyHint', payload.get('anomaly_hint', 0.0))),
        source=str(payload.get('source', 'backend-local-ai')),
        zoneId=str(payload.get('zoneId', payload.get('zone_id', 'unknown'))),
        history=history,
        temperature=float(payload.get('temperature', 0.0)),
        weather_condition=str(payload.get('weather_condition', payload.get('weatherCondition', 'unknown'))),
        incidents=str(payload.get('incidents', payload.get('incidentType', 'no_incident'))),
    )


_FEATURES = ['n_pedestrians','n_pedestrians_towards','n_pedestrians_away','towards_ratio','away_ratio','incidents'] + [f'lag_{l}' for l in range(1,13)] + ['delta_1','delta_2','delta_3']
_ANOM_FEATURES = ['n_pedestrians','n_pedestrians_towards','n_pedestrians_away','towards_ratio','away_ratio'] + [f'lag_{l}' for l in range(1,13)] + ['delta_1','delta_2','delta_3']

def _history_row(f: Features):
    h = [float(x) for x in f.history if np.isfinite(x) and x >= 0]
    if not h:
        h = [float(f.count)]
    h = h[-13:]
    current = h[-1]
    # pad with the oldest observed count; this keeps the endpoint usable while
    # clearly reporting that confidence is limited when history is short.
    if len(h) < 13: h = [h[0]] * (13-len(h)) + h
    lags = {i: h[-1-i] for i in range(1,13)}
    row = {
        'n_pedestrians': current,
        'n_pedestrians_towards': max(f.inflowRate * f.intervalSeconds, 0),
        'n_pedestrians_away': max(f.outflowRate * f.intervalSeconds, 0),
        'towards_ratio': 0.5, 'away_ratio': 0.5, 'incidents': f.incidents,
        'delta_1': current-lags[1], 'delta_2': current-lags[2], 'delta_3': current-lags[3],
    }
    total=max(current,1e-9); row['towards_ratio']=row['n_pedestrians_towards']/total; row['away_ratio']=row['n_pedestrians_away']/total
    for i in range(1,13): row[f'lag_{i}']=lags[i]
    return _pd.DataFrame([row]), len(f.history)

def _anomaly_from_decision(decision):
    # Convert using learned training quantiles, not a hand-tuned multiplier.
    p05=ANOM_META.get('calibration',{}).get('p05',0.0); p01=ANOM_META.get('calibration',{}).get('p01',p05-1e-6)
    if decision >= p05: return 0.0
    if decision <= p01: return 1.0
    return float(np.clip((p05-decision)/max(p05-p01,1e-9),0,1))

@app.get('/health')
def health():
    return {'ok': True, 'model': SURGE_VERSION if SURGE_MODEL else 'unavailable', 'anomalyModelLoaded': ANOM_MODEL is not None, 'version': '2.1.0'}

@app.post('/predict')
def predict(payload: dict = Body(...)):
    features = _normalize_prediction_payload(payload)
    if SURGE_MODEL is None or ANOM_MODEL is None:
        return {'available': False, 'error': 'real-data dynamics models are not installed'}
    row, history_len = _history_row(features)
    surge = float(SURGE_MODEL.predict_proba(row[_FEATURES])[0,1])
    anomaly_row = row[_ANOM_FEATURES].astype(float).replace([np.inf,-np.inf],np.nan).fillna(0)
    decision = float(ANOM_MODEL.decision_function(anomaly_row)[0])
    anomaly = _anomaly_from_decision(decision)
    confidence = float(np.clip(abs(surge-0.5)*2, 0, 1))
    return {
        'available': True,
        # Backward-compatible alias: this is a learned next-hour surge signal,
        # NOT a probability of an emergency or stampede.
        'risk': round(surge, 4),
        'surgeScore': round(surge, 4),
        'anomalyScore': round(anomaly, 4),
        'modelConfidence': round(confidence, 4),
        'historyPoints': history_len,
        'modelVersion': SURGE_VERSION,
        'source': 'real-trained-wuerzburg-dynamics',
        'target': 'next-hour rapid crowd increase',
        'disclaimer': 'Not an emergency/stampede probability; venue-specific validation is required.'
    }

# --- Real trained flow-forecast model -------------------------------------
# This model was trained on the uploaded Würzburg Foot Traffic train.csv.
# It is intentionally separate from the prototype risk classifier above:
# it predicts next-hour pedestrian flow and must not be presented as an
# emergency/stampede probability model.
_FLOW_MODEL_PATH = _os.path.join(_os.path.dirname(__file__), 'models', 'wuerzburg_flow_xgb.joblib')
FLOW_MODEL = _joblib.load(_FLOW_MODEL_PATH) if _os.path.exists(_FLOW_MODEL_PATH) else None
FLOW_MODEL_VERSION = 'WuerzburgFootTrafficNextHour-XGBoost-v1'

class HourPoint(BaseModel):
    date: str
    hour: int = Field(ge=0, le=23)
    weekday: str
    n_pedestrians: float = Field(ge=0)
    n_pedestrians_towards: float = Field(default=0, ge=0)
    n_pedestrians_away: float = Field(default=0, ge=0)
    temperature: float = 0
    weather_condition: str = 'unknown'
    incidents: str = 'no_incident'
    collection_type: str = 'measured'

class FlowForecastRequest(BaseModel):
    # 168 hourly observations are required because the trained model uses
    # a one-week lag. The final point is the time for which we forecast t+1.
    history: list[HourPoint] = Field(min_length=169, max_length=1000)
    streetname: str

_FLOW_FEATURES = ['streetname','hour','dow_num','month','temperature','weather_condition','incidents','collection_type','n_pedestrians','n_pedestrians_towards','n_pedestrians_away','towards_ratio','away_ratio','hour_sin','hour_cos','dayofyear_sin','dayofyear_cos'] + [f'ped_lag_{l}' for l in [1,2,3,24,48,168]] + [f'ped_roll_mean_{w}' for w in [3,6,24,168]] + [f'ped_roll_std_{w}' for w in [3,6,24,168]]

def _flow_row(req: FlowForecastRequest):
    rows = [p.model_dump() for p in req.history]
    df = _pd.DataFrame(rows)
    df['date'] = _pd.to_datetime(df['date'])
    df['streetname'] = req.streetname
    df = df.sort_values(['date','hour']).reset_index(drop=True)
    g = df.groupby(lambda _: req.streetname)
    # history is expected to be one continuous street series; explicit shifts
    # keep all features strictly in the past relative to the final row.
    s = df['n_pedestrians']
    for l in [1,2,3,24,48,168]: df[f'ped_lag_{l}'] = s.shift(l)
    shifted = s.shift(1)
    for w in [3,6,24,168]:
        df[f'ped_roll_mean_{w}'] = shifted.rolling(w).mean()
        df[f'ped_roll_std_{w}'] = shifted.rolling(w).std()
    df['hour_sin'] = np.sin(2*np.pi*df['hour']/24)
    df['hour_cos'] = np.cos(2*np.pi*df['hour']/24)
    df['dow_num'] = df['date'].dt.dayofweek
    df['month'] = df['date'].dt.month
    df['dayofyear_sin'] = np.sin(2*np.pi*df['date'].dt.dayofyear/365.25)
    df['dayofyear_cos'] = np.cos(2*np.pi*df['date'].dt.dayofyear/365.25)
    df['towards_ratio'] = df['n_pedestrians_towards']/df['n_pedestrians'].replace(0,np.nan)
    df['away_ratio'] = df['n_pedestrians_away']/df['n_pedestrians'].replace(0,np.nan)
    for c in ['weather_condition','incidents','collection_type']:
        df[c] = df[c].fillna('unknown')
    row = df.iloc[[-1]].copy()
    for c in _FLOW_FEATURES:
        if row[c].dtype.kind in 'fc': row[c] = row[c].replace([np.inf,-np.inf],np.nan).fillna(0)
        else: row[c] = row[c].fillna('unknown')
    return row[_FLOW_FEATURES], df.iloc[-1]

@app.get('/flow-model/health')
def flow_model_health():
    return {'loaded': FLOW_MODEL is not None, 'model': FLOW_MODEL_VERSION, 'target': 'next-hour pedestrian count', 'training_dataset': 'Würzburg Foot Traffic'}

@app.post('/flow-forecast')
def flow_forecast(req: FlowForecastRequest):
    if FLOW_MODEL is None:
        return {'available': False, 'error': 'trained flow model is not installed'}
    x, last = _flow_row(req)
    pred = max(0.0, float(FLOW_MODEL.predict(x)[0]))
    current = float(last['n_pedestrians'])
    growth = (pred-current)/max(abs(current),1.0)
    return {'available': True, 'forecastNextHour': round(pred,2), 'currentHourCount': round(current,2), 'forecastGrowthFraction': round(float(growth),4), 'model': FLOW_MODEL_VERSION, 'source': 'real-trained-wuerzburg-flow-model', 'disclaimer': 'Flow forecast only; not an emergency-risk probability.'}
