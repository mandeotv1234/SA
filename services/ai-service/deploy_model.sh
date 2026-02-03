#!/bin/bash
# Script to deploy trained model to AI Service
# Run this AFTER 'python3 train.py' finishes successfully

echo "========================================"
echo "AI Model Deployment"
echo "========================================"

# 1. Define paths
TRAINED_MODEL="./checkpoints/best_model.pth"
# Docker compose mounts ./ml_models to /app/models
TARGET_DIR="../../ml_models" 
TARGET_FILE="$TARGET_DIR/lstm_sentiment_hybrid_v1.pth"

# 2. Check if training finished
if [ ! -f "$TRAINED_MODEL" ]; then
    echo "❌ Trained model not found at $TRAINED_MODEL"
    echo "Please wait for 'python3 train.py' to finish."
    exit 1
fi

# 3. Create target directory if not exists
if [ ! -d "$TARGET_DIR" ]; then
    echo "Creating directory: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
fi

# 4. Copy model
echo "Copying model to $TARGET_FILE..."
cp "$TRAINED_MODEL" "$TARGET_FILE"

# 5. Restart AI Service Container
echo "Restarting infra-ai-service-1 container..."
docker restart infra-ai-service-1

if [ $? -eq 0 ]; then
    echo "✅ Model Deployed Successfully!"
    echo "New predictions will use the trained model."
else
    echo "⚠️  Failed to restart container. Please check docker."
fi
