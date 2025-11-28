import os
import numpy as np

MODEL_NAME = os.getenv("FINBERT_MODEL", "ProsusAI/finbert")
HAS_MODEL = False
try:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import torch
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    model.eval()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    HAS_MODEL = True
except Exception as e:
    print("FinBERT model load failed; using dummy scorer.", e)

def softmax(x):
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum(axis=-1)

def analyze_sentiment_text(text: str):
    if not text:
        return {"positive": 0.0, "negative": 0.0, "neutral": 1.0}
    if not HAS_MODEL:
        txt = text.lower()
        pos = 0.6 if any(w in txt for w in ("profit","positive","surge","bull","gain")) else 0.2
        neg = 0.6 if any(w in txt for w in ("drop","loss","decline","bear","plunge")) else 0.2
        neu = max(0.0, 1.0 - (pos + neg - 0.1))
        return {"positive": round(pos,2), "negative": round(neg,2), "neutral": round(neu,2)}
    import torch
    inputs = tokenizer(text, truncation=True, padding=True, return_tensors="pt").to(device)
    with torch.no_grad():
        logits = model(**inputs).logits.cpu().numpy()[0]
    probs = softmax(logits)
    if len(probs) >= 3:
        neg, neu, pos = probs[:3]
    else:
        pos = probs[0]; neg = 0.0; neu = 1.0-pos
    return {"positive": float(round(pos,4)), "negative": float(round(neg,4)), "neutral": float(round(neu,4))}
