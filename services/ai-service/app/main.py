import os
from fastapi import FastAPI
from threading import Thread
from app.kafka_consumer import start_consumer
from app.modules.causal import schedule_causal_job, run_causal_now
from app.modules.sentiment import analyze_sentiment_text
from app.kafka_producer import close_producer

app = FastAPI(title="AI Service")


@app.on_event("startup")
def startup_event():
    t = Thread(target=start_consumer, daemon=True)
    t.start()
    schedule_causal_job()


@app.on_event('shutdown')
def shutdown_event():
    try:
        close_producer()
    except Exception:
        pass


@app.get('/health')
def health():
    return {"alive": True}


@app.post('/sentiment/')
def sentiment_endpoint(text: str):
    return analyze_sentiment_text(text)


@app.post('/causal/run-now')
def causal_now():
    res = run_causal_now()
    return {"status": "ok", "result": res}
