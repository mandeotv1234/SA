
import csv
import os
import json
from datetime import datetime
try:
    from pymongo import MongoClient
    import pandas as pd
except ImportError:
    print("Installing requirements...")
    os.system("pip install pymongo pandas")
    from pymongo import MongoClient
    import pandas as pd

def export_mongo_to_csv():
    # Cấu hình connection
    # Nếu chạy trong Docker, dùng mongo-crawler:27017. Nếu chạy ngoài, dùng localhost:27018
    MONGO_URI = os.getenv("MONGO_URL", "mongodb://mongo-crawler:27017")
    if "localhost" in MONGO_URI and os.getenv("IN_DOCKER"):
         MONGO_URI = "mongodb://mongo-crawler:27017"

    # Fallback cho trường hợp chạy local test không set env
    try:
        # Quick test connection to localhost
        MongoClient("mongodb://localhost:27018", serverSelectionTimeoutMS=1000).server_info()
        MONGO_URI = "mongodb://localhost:27018"
        print("Using Localhost connection.")
    except:
        print(f"Localhost failed, trying default/env URI: {MONGO_URI}")

    DB_NAME = "crawler_db"
    
    print(f"Connecting to MongoDB at {MONGO_URI}...")
    
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        # Kiểm tra connection
        client.server_info()
        print("Connected successfully!")
        
        db = client[DB_NAME]
        
        # Lấy danh sách collections
        collections = db.list_collection_names()
        print(f"Found collections: {collections}")
        
        if not collections:
            print("No collections found in database.")
            return

        # Chọn collection chính (ưu tiên 'news_articles' hoặc 'articles')
        target_col = 'news_articles' if 'news_articles' in collections else collections[0]
        print(f"Exporting data from collection: {target_col}")
        
        cursor = db[target_col].find({})
        
        # Chuyển đổi sang list dictionary
        docs = list(cursor)
        print(f"Found {len(docs)} documents.")
        
        if not docs:
            print("Collection is empty.")
            return

        # Làm phẳng dữ liệu (nếu cần) và xử lý datetimeObject
        # Sử dụng pandas để dễ dàng export
        df = pd.DataFrame(docs)
        
        # Chuyển ObjectId sang string để dễ đọc
        if '_id' in df.columns:
            df['_id'] = df['_id'].astype(str)
            
        # Format lại các cột thời gian nếu có
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime('%Y-%m-%d %H:%M:%S')

        # File output name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = f"crawler_data_{target_col}_{timestamp}.csv"
        
        # Save to CSV
        df.to_csv(output_file, index=False, encoding='utf-8-sig')
        
        print(f"\n✅ SUCCESS! Data saved to: {os.path.abspath(output_file)}")
        print("Preview of first 3 rows:")
        print(df.head(3).to_string())

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        print("Make sure the MongoDB container is running and forwarding port 27018.")

if __name__ == "__main__":
    export_mongo_to_csv()
