import os
import logging
import json
from datetime import datetime
from pymongo import MongoClient, ASCENDING
from pymongo.errors import DuplicateKeyError

LOG = logging.getLogger("crawler.db")

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "crawler_db")

def get_db():
    client = MongoClient(MONGO_URL)
    return client[MONGO_DB]

def init_db():
    """Initialize Mongo indexes."""
    try:
        db = get_db()
        
        # Collection: crawl_sources
        # unique url
        db.crawl_sources.create_index([("url", ASCENDING)], unique=True)
        # index for active check
        db.crawl_sources.create_index([("is_active", ASCENDING)])
        
        # Collection: extraction_rules
        db.extraction_rules.create_index([("domain", ASCENDING)], unique=True)
        
        LOG.info("MongoDB indexes initialized.")
        
        # Auto-seed
        _seed_sources(db)
        
    except Exception as e:
        LOG.error(f"Failed to init DB: {e}")

def _seed_sources(db):
    """Seed sources if collection is empty."""
    try:
        count = db.crawl_sources.count_documents({})
        if count > 0:
            return

        seed_path = os.path.join(os.path.dirname(__file__), '../seeds/sources.json')
        if not os.path.exists(seed_path):
            LOG.warning(f"Seed file not found at {seed_path}")
            return

        with open(seed_path, 'r') as f:
            sources = json.load(f)
            
        ops = []
        for s in sources:
            doc = {
                "url": s['url'],
                "source_type": s.get('type', 'html'),
                "category": s.get('category', 'general'),
                "is_active": True,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
                "error_count": 0,
                "last_crawled_at": None
            }
            try:
                db.crawl_sources.insert_one(doc)
            except DuplicateKeyError:
                pass
                
        LOG.info(f"Auto-seeded sources from file.")
    except Exception as e:
        LOG.error(f"Auto-seeding failed: {e}")

def get_active_sources():
    db = get_db()
    # Find active, sort by last_crawled_at asc (null first)
    # in mongo, null sorts first by default or we can handle logic.
    sources = list(db.crawl_sources.find(
        {"is_active": True},
        limit=50
    ).sort("last_crawled_at", ASCENDING))
    return sources

def update_source_status(url, error=False):
    db = get_db()
    update = {
        "$set": {"last_crawled_at": datetime.utcnow()},
        "$inc": {"crawl_count": 1}
    }
    if error:
        update["$inc"]["error_count"] = 1
    else:
        update["$set"]["error_count"] = 0
        
    db.crawl_sources.update_one({"url": url}, update)

def get_extraction_rule(domain):
    db = get_db()
    doc = db.extraction_rules.find_one({"domain": domain, "active": True})
    return doc['selectors'] if doc else None

def save_extraction_rule(domain, selectors):
    db = get_db()
    db.extraction_rules.update_one(
        {"domain": domain},
        {"$set": {
            "selectors": selectors, 
            "updated_at": datetime.utcnow(),
            "active": True
        }},
        upsert=True
    )
