"""Validated administration settings. Secrets are input-only."""

from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class DatabaseSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    host: str = Field(min_length=1, max_length=253, pattern=r"^[a-zA-Z0-9_.:\-]+$")
    port: int = Field(ge=1, le=65535)
    user: str = Field(min_length=1, max_length=128)
    database: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_\-]+$")
    password: SecretStr | None = None


class ModelSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    model_name: str = Field(min_length=1, max_length=200)
    base_url: str = Field(max_length=2048)
    api_key: SecretStr | None = None

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value):
        if not value:
            return value
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("模型地址必须是 HTTP 或 HTTPS 地址")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("模型地址不能包含账号、密码、查询参数或片段")
        return value.rstrip("/")


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: str
    db_meta: DatabaseSettingsInput
    db_dw: DatabaseSettingsInput
    llm: ModelSettingsInput
