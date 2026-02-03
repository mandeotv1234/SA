#!/usr/bin/env python3
"""Fix direction_1h variable reference error."""

with open('app/modules/inference.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the problematic confidence calculation block (around line 216-230)
# and remove it temporarily
new_lines = []
skip_until = -1

for i, line in enumerate(lines):
    if skip_until > 0 and i < skip_until:
        continue
    
    # Find start of confidence calculation block
    if '# Improved confidence calculation' in line and i < 250:
        # Skip this entire block (until volatility_val)
        skip_until = i
        for j in range(i, min(i+30, len(lines))):
            if 'volatility_val = aligned_df' in lines[j]:
                skip_until = j
                break
        continue
    
    new_lines.append(line)

# Now find where direction_1h is determined and add confidence calc after it
final_lines = []
for i, line in enumerate(new_lines):
    final_lines.append(line)
    
    # After direction is determined, add confidence calculation
    if 'direction_1h = "DOWN"' in line and i > 250:
        final_lines.append('''
        # Calculate confidence based on direction
        if direction_1h == "SIDEWAYS":
            distance_from_center = abs(prob_value - 0.5)
            max_sideways_distance = 0.02
            sideways_strength = 1 - (distance_from_center / max_sideways_distance)
            confidence_1h = 60 + (sideways_strength * 25)
        else:
            raw_confidence = abs(prob_value - 0.5) * 2 * 100
            confidence_1h = min(95, max(40, 40 + raw_confidence * 1.1))
        
''')
        break

# Copy rest of lines
final_lines.extend(new_lines[i+1:])

with open('app/modules/inference.py', 'w', encoding='utf-8') as f:
    f.writelines(final_lines)

print("✓ Fixed direction_1h variable reference")
