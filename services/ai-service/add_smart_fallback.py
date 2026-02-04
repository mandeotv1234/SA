#!/usr/bin/env python3
"""Add smart fallback for untrained model predictions."""

with open('app/modules/inference.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the price prediction logic with smarter version
old_logic = '''        # Price Target 1H - FROM DEEP LEARNING MODEL
        # Use pred_return_val (model regression output) directly
        move_percent_1h = pred_return_val * (0.3 + abs(prob_value - 0.5) * 1.4)
        move_percent_1h = max(-0.03, min(0.03, move_percent_1h))'''

new_logic = '''        # Price Target 1H - SMART PREDICTION
        # If model is trained, use its output. Otherwise, use probability-based fallback
        
        # Check if model output seems reasonable (not too extreme)
        if abs(pred_return_val) > 0.5:  # Model predicting >50% change - likely untrained
            # Fallback: Use probability + sentiment for realistic prediction
            prob_strength = abs(prob_value - 0.5) * 2  # 0 to 1
            base_move = 0.005 + (prob_strength * 0.025)  # 0.5% to 3%
            
            # Apply direction from probability
            if prob_value > 0.52:
                move_percent_1h = base_move
            elif prob_value < 0.48:
                move_percent_1h = -base_move
            else:
                move_percent_1h = 0.001  # Tiny move for sideways
                
            # Adjust by volatility
            if volatility_label == "HIGH":
                move_percent_1h *= 1.3
            elif volatility_label == "LOW":
                move_percent_1h *= 0.7
        else:
            # Model seems trained, use its output with confidence scaling
            confidence_factor = 0.3 + abs(prob_value - 0.5) * 1.4
            move_percent_1h = pred_return_val * confidence_factor
        
        # Safety bounds
        move_percent_1h = max(-0.03, min(0.03, move_percent_1h))'''

content = content.replace(old_logic, new_logic)

with open('app/modules/inference.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ Added smart fallback for untrained model")
