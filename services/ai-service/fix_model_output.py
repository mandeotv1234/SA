#!/usr/bin/env python3
"""Fix model output unpacking."""

with open('app/modules/inference.py', 'r') as f:
    content = f.read()

# Replace old unpacking (3 values) with new (4 values)
content = content.replace(
    'prob, pred_return_tensor, attn_weights = self.model(X_price_last, X_news_last)',
    'pred_1h, pred_24h, volatility_probs, attn_weights = self.model(X_price_last, X_news_last)'
)

# Update variable usage
content = content.replace('prob_value = prob.item()', "prob_value = pred_1h['direction'].item()")
content = content.replace('pred_return_val = pred_return_tensor.item()', "pred_return_val = pred_1h['return'].item()")

with open('app/modules/inference.py', 'w') as f:
    f.write(content)

print("✓ Fixed model output unpacking")
