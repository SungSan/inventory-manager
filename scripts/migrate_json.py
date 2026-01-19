import argparse
import json
import os
import sys
import uuid
from typing import Any, Dict

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate legacy JSON data to Supabase.")
    parser.add_argument(
        "--supabase-url",
        default=os.environ.get("SUPABASE_URL"),
        help="Supabase project URL (env: SUPABASE_URL).",
    )
    parser.add_argument(
        "--service-role-key",
        default=os.environ.get("SUPABASE_SERVICE_ROLE_KEY"),
        help="Supabase service role key (env: SUPABASE_SERVICE_ROLE_KEY).",
    )
    parser.add_argument(
        "--source-json",
        default=os.environ.get("SOURCE_JSON", "inventory_data.json"),
        help="Path to legacy JSON data (env: SOURCE_JSON).",
    )
    return parser.parse_args()


args = parse_args()
SUPABASE_URL = args.supabase_url
SERVICE_ROLE = args.service_role_key
JSON_PATH = args.source_json

if not SUPABASE_URL or not SERVICE_ROLE:
    print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or flags).")
    sys.exit(1)

if not os.path.exists(JSON_PATH):
    print(f"Source JSON not found: {JSON_PATH}")
    sys.exit(1)

with open(JSON_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

session = requests.Session()
session.headers.update({
    'apikey': SERVICE_ROLE,
    'Authorization': f'Bearer {SERVICE_ROLE}',
    'Content-Type': 'application/json'
})

rest_base = f"{SUPABASE_URL}/rest/v1"

def upsert(table: str, rows: Any):
    resp = session.post(f"{rest_base}/{table}", params={'on_conflict': 'id', 'return': 'minimal'}, json=rows)
    if resp.status_code >= 300:
        print(f"Failed {table}: {resp.status_code} {resp.text}")
        sys.exit(1)

# naive mapping
items_map: Dict[str, str] = {}

stocks = data.get('stock', []) or data.get('stocks', []) or []
for row in stocks:
    key = (row['artist'], row.get('category', 'album'), row['item'], row.get('option', ''))
    if key not in items_map:
        item_id = str(uuid.uuid4())
        items_map[key] = item_id
        upsert('items', [{
            'id': item_id,
            'artist': key[0],
            'category': key[1],
            'album_version': key[2],
            'option': key[3]
        }])
    inv_id = str(uuid.uuid4())
    upsert('inventory', [{
        'id': inv_id,
        'item_id': items_map[key],
        'location': row.get('location', ''),
        'quantity': int(row.get('current_stock', row.get('quantity', 0)))
    }])

history = data.get('history', []) or data.get('movements', []) or []
for mov in history:
    key = (mov['artist'], mov.get('category', 'album'), mov['item'], mov.get('option', ''))
    item_id = items_map.get(key)
    if not item_id:
        item_id = str(uuid.uuid4())
        items_map[key] = item_id
        upsert('items', [{
            'id': item_id,
            'artist': key[0],
            'category': key[1],
            'album_version': key[2],
            'option': key[3]
        }])
    mov_id = str(uuid.uuid4())
    upsert('movements', [{
        'id': mov_id,
        'item_id': item_id,
        'location': mov.get('location', ''),
        'direction': mov.get('direction', 'IN'),
        'quantity': int(mov.get('quantity', 0)),
        'memo': mov.get('description', ''),
        'created_at': mov.get('timestamp') or mov.get('created_at')
    }])

print('Migration completed')
