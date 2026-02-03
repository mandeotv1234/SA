#!/bin/bash
# Training Pipeline for AI Service
# Run this script inside the ai-service container or with proper environment

echo "========================================"
echo "AI Model Training Pipeline"
echo "========================================"

# Step 1: Collect training data from MongoDB and TimescaleDB
echo "[1/3] Collecting training data..."
python collect_training_data.py
if [ $? -ne 0 ]; then
    echo "❌ Data collection failed!"
    exit 1
fi

# Step 2: Verify data exists
if [ ! -f "./training_data/historical_candles.csv" ] || [ ! -f "./training_data/historical_news.csv" ]; then
    echo "❌ Training data files not found!"
    exit 1
fi

echo "✓ Training data collected successfully"
echo "  - Candles: $(wc -l < ./training_data/historical_candles.csv) rows"
echo "  - News: $(wc -l < ./training_data/historical_news.csv) rows"

# Step 3: Run training
echo ""
echo "[2/3] Training model..."
python train.py
if [ $? -ne 0 ]; then
    echo "❌ Training failed!"
    exit 1
fi

# Step 4: Copy model to app directory
echo ""
echo "[3/3] Deploying model..."
if [ -f "./checkpoints/best_model.pth" ]; then
    cp ./checkpoints/best_model.pth ./app/model_weights/trained_model.pth
    echo "✓ Model deployed to app/model_weights/trained_model.pth"
else
    echo "⚠️ No best_model.pth found in checkpoints"
fi

echo ""
echo "========================================"
echo "Training Complete!"
echo "========================================"
echo "Restart the ai-service to load the new model:"
echo "  docker restart infra-ai-service-1"
