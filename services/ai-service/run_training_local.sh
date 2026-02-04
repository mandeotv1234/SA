#!/bin/bash
# Local Training Script (Recommended due to Docker memory limits)

echo "Starting Local Training..."

# 1. Install dependencies (if missing)
echo "Checking dependencies..."
pip3 install torch pandas transformers scikit-learn tqdm requests ta --quiet

# 2. Run training
echo "Running train.py (output to training_log.txt)..."
python3 train.py 2>&1 | tee training_log.txt

# 3. Deploy if successful
if [ $? -eq 0 ]; then
    echo ""
    echo "Training Finished Successfully!"
    read -p "Do you want to deploy this model to Docker now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ./deploy_model.sh
    fi
else
    echo "❌ Training Failed. Check training_log.txt"
fi
