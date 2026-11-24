"""Small bounded local audit trail; callers only pass non-sensitive summaries."""

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

from app.services.admin_settings import atomic_json


class AdminAudit:
    def __init__(self, path: Path):
        self.path = path
        self.lock = RLock()

    def read(self, limit=50):
        with self.lock:
            if not self.path.exists():
                return {"items": []}
            try:
                items = json.loads(self.path.read_text(encoding="utf-8"))
                if not isinstance(items, list):
                    raise ValueError()
            except ValueError, OSError:
                return {
                    "items": [
                        {
                            "id": "unavailable",
                            "at": "",
                            "action": "audit.read",
                            "status": "error",
                            "message": "本地操作日志无法读取。",
                        }
                    ]
                }
            return {"items": list(reversed(items[-limit:]))}

    def record(self, action, status="done", message=""):
        with self.lock:
            items = list(reversed(self.read(500)["items"]))
            items.append(
                {
                    "id": uuid4().hex,
                    "at": datetime.now(timezone.utc).isoformat(),
                    "action": action,
                    "status": status,
                    "message": message,
                }
            )
            atomic_json(self.path, items[-500:])
