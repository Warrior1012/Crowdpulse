# Reproducible training script for CrowdPulse's first real ML model.
# Target: next-hour pedestrian count within the same street.
# This is a forecasting model, not an emergency/stampede classifier.
import argparse, json, os
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

FEATURES = ['streetname','hour','dow_num','month','temperature','weather_condition','incidents','collection_type','n_pedestrians','n_pedestrians_towards','n_pedestrians_away','towards_ratio','away_ratio','hour_sin','hour_cos','dayofyear_sin','dayofyear_cos'] + [f'ped_lag_{l}' for l in [1,2,3,24,48,168]] + [f'ped_roll_mean_{w}' for w in [3,6,24,168]] + [f'ped_roll_std_{w}' for w in [3,6,24,168]]
CAT=['streetname','weather_condition','incidents','collection_type']

def score(y,p):
    return {'MAE':float(mean_absolute_error(y,p)),'RMSE':float(mean_squared_error(y,p)**0.5),'R2':float(r2_score(y,p)),'sMAPE':float(np.mean(2*np.abs(p-y)/(np.abs(y)+np.abs(p)+1e-6))*100)}

def build(raw):
    df=raw.copy(); df['date']=pd.to_datetime(df['date']); df['city']=df['city'].astype(str).str.strip(); df=df.sort_values(['streetname','date','hour']).reset_index(drop=True); g=df.groupby('streetname',group_keys=False)
    df['target_next_hour']=g['n_pedestrians'].shift(-1)
    for l in [1,2,3,24,48,168]: df[f'ped_lag_{l}']=g['n_pedestrians'].shift(l)
    for w in [3,6,24,168]:
        shifted=g['n_pedestrians'].shift(1)
        df[f'ped_roll_mean_{w}']=shifted.groupby(df['streetname']).rolling(w).mean().reset_index(level=0,drop=True).reset_index(drop=True)
        df[f'ped_roll_std_{w}']=shifted.groupby(df['streetname']).rolling(w).std().reset_index(level=0,drop=True).reset_index(drop=True)
    df['hour_sin']=np.sin(2*np.pi*df['hour']/24); df['hour_cos']=np.cos(2*np.pi*df['hour']/24); df['dow_num']=df['date'].dt.dayofweek; df['month']=df['date'].dt.month
    df['dayofyear_sin']=np.sin(2*np.pi*df['date'].dt.dayofyear/365.25); df['dayofyear_cos']=np.cos(2*np.pi*df['date'].dt.dayofyear/365.25)
    df['towards_ratio']=df['n_pedestrians_towards']/df['n_pedestrians'].replace(0,np.nan); df['away_ratio']=df['n_pedestrians_away']/df['n_pedestrians'].replace(0,np.nan)
    for c in ['weather_condition','incidents','collection_type']: df[c]=df[c].fillna('unknown')
    df=df.dropna(subset=['target_next_hour']+[f'ped_lag_{l}' for l in [1,2,3,24,48,168]]).copy()
    for c in FEATURES:
        if df[c].dtype.kind in 'fc': df[c]=df[c].replace([np.inf,-np.inf],np.nan).fillna(0)
        else: df[c]=df[c].fillna('unknown')
    return df

def make_pipe():
    pre=ColumnTransformer([('cat',OneHotEncoder(handle_unknown='ignore',sparse_output=False),CAT),('num','passthrough',[c for c in FEATURES if c not in CAT])])
    model=XGBRegressor(n_estimators=250,max_depth=6,learning_rate=.06,subsample=.85,colsample_bytree=.9,objective='reg:squarederror',n_jobs=4,random_state=42,tree_method='hist')
    return Pipeline([('pre',pre),('model',model)])

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--input',required=True); ap.add_argument('--output',default='ai-service/models'); a=ap.parse_args()
    df=build(pd.read_csv(a.input)); dates=np.sort(df.date.unique()); d1=dates[int(len(dates)*.70)]; d2=dates[int(len(dates)*.85)]
    tr=df[df.date<d1]; va=df[(df.date>=d1)&(df.date<d2)]; te=df[df.date>=d2]
    p=make_pipe(); p.fit(tr[FEATURES],tr.target_next_hour); pv=p.predict(va[FEATURES]); pt=p.predict(te[FEATURES])
    os.makedirs(a.output,exist_ok=True); final=make_pipe(); combo=pd.concat([tr,va]); final.fit(combo[FEATURES],combo.target_next_hour); joblib.dump(final,os.path.join(a.output,'wuerzburg_flow_xgb.joblib'),compress=3)
    meta={'model':'XGBoost','version':'1.0.0','target':'next-hour n_pedestrians within same street','dataset':'Würzburg Foot Traffic','source':'https://www.kaggle.com/competitions/foot-traffic-wue/data','split':{'train_end':str(d1),'validation_end':str(d2),'test_start':str(d2)},'validation':score(va.target_next_hour,pv),'test':score(te.target_next_hour,pt),'naive_current_count_test':score(te.target_next_hour,te.n_pedestrians),'features':FEATURES,'limitations':['Forecasts pedestrian flow, not emergency probability.','Würzburg street-counter data is not equivalent to venue-camera occupancy.']}
    with open(os.path.join(a.output,'model_metadata.json'),'w') as f: json.dump(meta,f,indent=2)
    print(json.dumps(meta,indent=2))
if __name__=='__main__': main()
