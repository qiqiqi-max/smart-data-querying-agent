"""Load locally saved administrator settings without exposing secrets in errors."""

import json
from pathlib import Path

FIELDS = {
    "db_meta": {"host", "port", "user", "database", "password"},
    "db_dw": {"host", "port", "user", "database", "password"},
    "llm": {"model_name", "base_url", "api_key"},
}


def load_admin_overrides(data_dir: Path) -> dict:
    path = data_dir / "admin" / "settings.json"
    if not path.exists():
        return {}
    try:
        values = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(values, dict):
            raise ValueError()
        result = {}
        for section, names in FIELDS.items():
            if section not in values:
                continue
            if not isinstance(values[section], dict):
                raise ValueError()
            result[section] = {}
            for key, value in values[section].items():
                if key not in names:
                    continue
                if key == "port":
                    if type(value) is not int or not 1 <= value <= 65535:
                        raise ValueError()
                elif not isinstance(value, str):
                    raise ValueError()
                result[section][key] = value
        return result
    except ValueError, OSError, TypeError:
        raise RuntimeError("后台配置文件无效，请检查本地 admin/settings.json") from None
