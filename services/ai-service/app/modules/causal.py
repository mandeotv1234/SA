import os
import time
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import shap
from app.kafka_producer import produce_ai_insight

def fetch_features_and_target():
    # Placeholder: in production, query TimescaleDB to get aligned features and target
    np.random.seed(0)
    X = pd.DataFrame({
        "sentiment_pos": np.random.rand(100),
        "market_momentum": np.random.rand(100),
        "volume": np.random.rand(100)
    })
    y = X["market_momentum"]*0.6 + X["sentiment_pos"]*0.3 + 0.1*np.random.randn(100)
    return X, y

def causal_explain(X, y):
    model = RandomForestRegressor(n_estimators=50)
    model.fit(X, y)
    explainer = shap.Explainer(model.predict, X)
    shap_values = explainer(X)
    mean_abs_shap = np.abs(shap_values.values).mean(axis=0)
    contribution = mean_abs_shap / mean_abs_shap.sum()
    res = {feat: float(round(100*float(contribution[i]),2)) for i, feat in enumerate(X.columns)}
    return {"model": "RandomForest", "contribution_percent": res}

def run_causal_now():
    X, y = fetch_features_and_target()
    res = causal_explain(X, y)
    insight = {
        "timestamp": int(time.time()),
        "explanation": res,
        "summary": "Auto causal run"
    }
    produce_ai_insight(insight)
    return insight

from apscheduler.schedulers.background import BackgroundScheduler

def schedule_causal_job():
    interval_minutes = int(os.getenv("CAUSAL_INTERVAL_MIN", "60"))
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_causal_now, 'interval', minutes=interval_minutes, id="causal_job", replace_existing=True)
    scheduler.start()
    print(f"Causal job scheduled every {interval_minutes} minutes")
