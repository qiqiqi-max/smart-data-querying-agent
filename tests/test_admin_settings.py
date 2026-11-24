from copy import deepcopy
from dataclasses import asdict

import pytest
from fastapi import HTTPException

from app.conf.app_config import app_config


def make_service(tmp_path):
    from app.services.admin_settings import AdminSettingsService

    config = deepcopy(app_config)
    config.db_meta.password = "meta-canary-password"
    config.db_dw.password = "dw-canary-password"
    config.llm.api_key = "model-canary-secret"
    config.llm.base_url = "https://model.example/v1"
    return AdminSettingsService(tmp_path / "settings.json", config)


def update_body(service):
    current = service.read()
    result = {"revision": current["revision"]}
    for key, values in current["saved"].items():
        result[key] = {
            name: value for name, value in values.items() if not name.endswith("_set")
        }
    return result


def test_settings_read_never_returns_credentials(tmp_path):
    service = make_service(tmp_path)
    payload = service.read()
    assert "canary" not in str(payload)
    assert payload["effective"]["llm"]["api_key_set"] is True
    assert payload["saved"]["db_meta"]["password_set"] is True
    assert payload["restart_required"] is False


def test_save_preserves_blank_secrets_and_tracks_effective_config(tmp_path):
    from app.api.schemas.admin_settings_schema import SettingsUpdate

    service = make_service(tmp_path)
    payload = update_body(service)
    payload["llm"].update(model_name="changed-model", api_key="")
    payload["db_dw"].update(password="", database="dw_next")
    response = service.save(SettingsUpdate.model_validate(payload))
    assert response["restart_required"] is True
    assert response["saved"]["llm"]["model_name"] == "changed-model"
    assert response["effective"]["llm"]["model_name"] != "changed-model"
    assert "canary" not in str(response)
    persisted = service._load_saved()
    assert persisted["llm"]["api_key"] == "model-canary-secret"
    assert persisted["db_dw"]["password"] == "dw-canary-password"


def test_stale_settings_revision_rejected_without_overwriting(tmp_path):
    from app.api.schemas.admin_settings_schema import SettingsUpdate

    service = make_service(tmp_path)
    payload = update_body(service)
    payload["llm"]["model_name"] = "first"
    service.save(SettingsUpdate.model_validate(payload))
    payload["llm"]["model_name"] = "second"
    with pytest.raises(HTTPException) as exc:
        service.save(SettingsUpdate.model_validate(payload))
    assert exc.value.status_code == 409
    assert service.read()["saved"]["llm"]["model_name"] == "first"


@pytest.mark.parametrize(
    "url",
    [
        "file:///secret",
        "https://user:pass@example.org/v1",
        "https://example.org/v1?key=secret",
    ],
)
def test_model_endpoint_rejects_non_http_and_embedded_secrets(url):
    from pydantic import ValidationError

    from app.api.schemas.admin_settings_schema import ModelSettingsInput

    with pytest.raises(ValidationError):
        ModelSettingsInput(model_name="model", base_url=url)


def test_runtime_override_loading_applies_only_supported_sections(tmp_path):
    import json

    from app.conf.admin_overrides import load_admin_overrides

    path = tmp_path / "admin" / "settings.json"
    path.parent.mkdir()
    path.write_text(
        json.dumps(
            {"llm": {"model_name": "new", "api_key": "private"}, "demo_mode": True}
        ),
        encoding="utf-8",
    )
    overrides = load_admin_overrides(tmp_path)
    assert overrides == {"llm": {"model_name": "new", "api_key": "private"}}


def test_invalid_stored_settings_fail_clearly_without_secret_echo(tmp_path):
    service = make_service(tmp_path)
    service.path.write_text('{"secret":"do-not-echo",', encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        service.read()
    assert exc.value.status_code == 503
    assert "do-not-echo" not in str(exc.value.detail)


def test_persisted_settings_apply_on_next_configuration_load(tmp_path):
    from app.api.schemas.admin_settings_schema import SettingsUpdate
    from app.conf.admin_overrides import load_admin_overrides

    config = deepcopy(app_config)
    from app.services.admin_settings import AdminSettingsService

    service = AdminSettingsService(tmp_path / "admin" / "settings.json", config)
    payload = update_body(service)
    payload["llm"].update(model_name="next-startup", api_key="replacement-key")
    service.save(SettingsUpdate.model_validate(payload))
    overrides = load_admin_overrides(tmp_path)
    for section, values in overrides.items():
        for key, value in values.items():
            setattr(getattr(config, section), key, value)
    after = AdminSettingsService(service.path, config).read()
    assert after["restart_required"] is False
    assert after["effective"]["llm"]["model_name"] == "next-startup"
    assert asdict(config.llm)["api_key"] == "replacement-key"


def test_changed_endpoint_requires_explicit_secret_before_save(tmp_path):
    from app.api.schemas.admin_settings_schema import SettingsUpdate

    service = make_service(tmp_path)
    payload = update_body(service)
    payload["llm"]["base_url"] = "https://different.example/v1"
    with pytest.raises(HTTPException) as exc:
        service.save(SettingsUpdate.model_validate(payload))
    assert exc.value.status_code == 422
    assert service.read()["restart_required"] is False


def test_mysql_url_preserves_reserved_characters_in_password():
    from sqlalchemy.engine import make_url

    from app.clients.mysql_client_manager import MySQLClientManager
    from app.conf.app_config import DBConfig

    manager = MySQLClientManager(
        DBConfig(
            host="localhost", port=3306, user="name", password="x@:/?#%", database="db"
        )
    )
    assert make_url(manager._get_url()).password == "x@:/?#%"


def test_override_strings_remain_literal_during_actual_config_load(tmp_path):
    import json

    from app.conf.app_config import load_app_config

    template = tmp_path / "app.yaml"
    # A complete base config is needed; use the project's structure with inert fake secrets.
    import yaml

    values = asdict(deepcopy(app_config))
    values["local_data_dir"] = str(tmp_path)
    values["db_meta"]["password"] = "secret-canary"
    values["db_dw"]["password"] = "fake-dw"
    values["llm"]["api_key"] = "fake-key"
    template.write_text(yaml.safe_dump(values), encoding="utf-8")
    path = tmp_path / "admin" / "settings.json"
    path.parent.mkdir()
    path.write_text(
        json.dumps(
            {
                "llm": {
                    "model_name": "${db_meta.password}",
                    "api_key": "literal-${dollars}",
                }
            }
        ),
        encoding="utf-8",
    )
    config = load_app_config(template)
    assert config.llm.model_name == "${db_meta.password}"
    assert config.llm.api_key == "literal-${dollars}"
