import os
import json
import logging
import sys

# Add parent dir to path to import app modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from app.db import init_db, get_connection

logging.basicConfig(level=logging.INFO)
LOG = logging.getLogger("seed_db")

def seed():
    init_db()
    
    seed_file = os.path.join(os.path.dirname(__file__), '../seeds/sources.json')
    if not os.path.exists(seed_file):
        LOG.error("Seeds file not found!")
        return

    with open(seed_file, 'r') as f:
        sources = json.load(f)
        
    conn = get_connection()
    try:
        count = 0
        with conn.cursor() as cur:
            for s in sources:
                cur.execute("""
                    INSERT INTO crawl_sources (url, source_type, category, created_at, updated_at)
                    VALUES (%s, %s, %s, NOW(), NOW())
                    ON CONFLICT (url) DO NOTHING
                """, (s['url'], s['type'], s.get('category', 'general')))
                if cur.rowcount > 0:
                    count += 1
        conn.commit()
        LOG.info(f"Seeded {count} new sources.")
    except Exception as e:
        LOG.error(f"Seeding failed: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    seed()
