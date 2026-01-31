
import sys
import os

# Add service path to sys.path
sys.path.append(os.path.abspath('/Users/lap14005/Documents/infra/services/ai-service'))

from app.modules.inference import InferenceEngine
import pandas as pd
import numpy as np

# Mock classes to avoid full DB/Model loading
class MockModel:
    def __call__(self, x_price, x_news):
        # Return fake prob and attention
        # Batch size 1. 
        prob = type('obj', (object,), {'item': lambda: 0.8}) # UP
        
        # Fake attention weights [1, 30, 1]
        # Case 1: High attention at last step
        attn = np.zeros((1, 30, 1))
        attn[0, -1, 0] = 0.9 # High attention
        attn_tensor = type('obj', (object,), {'squeeze': lambda: type('obj', (object,), {'cpu': lambda: type('obj', (object,), {'numpy': lambda: attn})})})
        
        return prob, attn_tensor

    def load_state_dict(self, path): pass
    def eval(self): pass
    def to(self, device): return self

class MockOllama:
    def generate(self, prompt):
        return {"response": "{\"mock\": \"response\"}"}
    def extract_response(self, res):
        return res['response']

# Patch modules
import app.modules.inference
app.modules.inference.DualStreamNetwork = lambda: MockModel()

# Init Engine
engine = InferenceEngine()
engine.ollama_client = MockOllama()

# Mock Data
print("--- TEST 1: News Driven (High Attention) ---")
# Create dummy aligned df
dates = pd.date_range(end=pd.Timestamp.now(), periods=35, freq='15min')
aligned_df = pd.DataFrame({
    'timestamp': dates,
    'open': [100]*35, 'high': [105]*35, 'low': [95]*35, 'close': [102]*35, 'volume': [1000]*35
})
# Hack processor
engine.data_processor.align_news_to_candles = lambda c, n, t: aligned_df
engine.data_processor.prepare_lstm_input = lambda self, df, lb: (torch.zeros(1, 30, 5), torch.zeros(1, 30, 768))

import torch

# Dummy News List
news_list = [{'timestamp': pd.Timestamp.now().timestamp(), 'title': 'Bitcoin ETF Approved', 'source': 'Coindesk', 'sentiment_score': 0.9}]

# Run Prediction
res = engine.predict_for_symbol("BTCUSDT", news_list)
print(f"Driver: {res['debug_metadata']['driver']}")
print(f"Explanation Type: {res['causal_analysis'].get('primary_driver', 'N/A')}")

print("\n--- TEST 2: Technical Driven (Low/No News) ---")
# Force low attention in mock? 
# Hard to mock internal logic dynamically without more complex patching.
# But we can verify the logic structure by inspecting the first output.
