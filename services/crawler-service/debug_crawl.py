
import requests
import xml.etree.ElementTree as ET
import time

def trigger_one():
    try:
        # 1. Get RSS
        print("Fetching RSS from Cointelegraph...")
        # Sử dụng session để giả lập browser tránh 403 nếu cần
        headers = {'User-Agent': 'Mozilla/5.0'}
        try:
            resp = requests.get("https://cointelegraph.com/rss", headers=headers, timeout=10)
            if resp.status_code != 200:
                print(f"RSS fetch failed: {resp.status_code}")
                # Fallback URL known to exist (hopefully)
                link = "https://cointelegraph.com/news/bitcoin-etf-flows-turn-positive-blackrock-ibit"
                print(f"Using fallback link: {link}")
            else:
                root = ET.fromstring(resp.content)
                first_item = root.find(".//item")
                link = first_item.find("link").text.strip()
                print(f"Found RSS article: {link}")
        except Exception as e:
             print(f"RSS Error: {e}")
             link = "https://cointelegraph.com/news/ethereum-price-prediction-3k-target"

        # 2. Trigger Crawl
        print(f"Triggering crawl API for: {link}")
        api_resp = requests.post("http://localhost:8001/crawl/", json={"url": link})
        print(f"Trigger Status: {api_resp.status_code}")
        print(f"Trigger Response: {api_resp.json()}")

        # 3. Wait and Check MongoDB
        print("Waiting 10s for processing...")
        time.sleep(10)
        
        from app.db import get_db
        db = get_db()
        doc = db.news_articles.find_one({"url": link})
        
        if doc:
            print(f"\n✅ SUCCESS! Found article in MongoDB.")
            print(f"Title: {doc.get('title')}")
            content = doc.get('content', '')
            print(f"Content Length: {len(content)}")
            print(f"Content Preview: {content[:100]}...")
            
            if len(content) < 100:
                print("⚠️ WARNING: Content seems too short!")
            else:
                print("✅ Content looks good (full text).")
        else:
            print("\n❌ FAILURE: Article NOT found in MongoDB after 10s.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    trigger_one()
