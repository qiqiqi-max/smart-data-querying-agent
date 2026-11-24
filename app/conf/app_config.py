"""
应用主配置

定义 conf/app_config.yaml 在程序中的结构化配置对象
项目启动后会在这里一次性完成配置文件加载和类型化转换，其他模块只需要导入 app_config
就可以按属性方式读取日志 MySQL Qdrant Embedding Elasticsearch 和 LLM 配置
"""

from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv
from omegaconf import OmegaConf

from app.conf.admin_overrides import load_admin_overrides


@dataclass
class File:
    """文件日志配置"""

    enable: bool
    level: str
    path: str
    rotation: str
    retention: str


@dataclass
class Console:
    """控制台日志配置"""

    enable: bool
    level: str


@dataclass
class LoggingConfig:
    """日志总配置"""

    file: File
    console: Console


@dataclass
class DBConfig:
    """MySQL 连接配置"""

    host: str
    port: int
    user: str
    # 敏感字段不进入 repr，避免打印或记录配置对象时泄露
    password: str = field(repr=False)
    database: str


@dataclass
class QdrantConfig:
    """Qdrant 连接与向量维度配置"""

    host: str
    port: int
    embedding_size: int


@dataclass
class EmbeddingConfig:
    """Embedding 服务配置"""

    host: str
    port: int
    model: str
    model_path: str


@dataclass
class ESConfig:
    """Elasticsearch 配置"""

    host: str
    port: int
    index_name: str


@dataclass
class LLMConfig:
    """大模型调用配置"""

    model_name: str
    api_key: str = field(repr=False)
    base_url: str


@dataclass
class AppConfig:
    """项目级总配置入口"""

    demo_mode: bool
    local_mode: bool
    local_data_dir: str
    logging: LoggingConfig
    db_meta: DBConfig
    db_dw: DBConfig
    qdrant: QdrantConfig
    embedding: EmbeddingConfig
    es: ESConfig
    llm: LLMConfig


# 从当前文件位置回到项目根目录，再定位到 conf/app_config.yaml
project_root = Path(__file__).parents[2]
config_file = project_root / "conf" / "app_config.yaml"


def resolve_project_path(value: str) -> Path:
    """把配置中的相对路径统一解析到项目根目录。"""

    path = Path(value)
    return path if path.is_absolute() else project_root / path


# 先读取本地 .env，让 YAML 中的 ${oc.env:...} 可以解析到敏感配置
load_dotenv(project_root / ".env")


def load_app_config(path: Path) -> AppConfig:
    context = OmegaConf.load(path)
    schema = OmegaConf.structured(AppConfig)
    # Only the trusted YAML supports interpolation; UI input is always literal text.
    result: AppConfig = OmegaConf.to_object(OmegaConf.merge(schema, context))
    overrides = load_admin_overrides(resolve_project_path(result.local_data_dir))
    for section, values in overrides.items():
        for name, value in values.items():
            setattr(getattr(result, section), name, value)
    return result


app_config: AppConfig = load_app_config(config_file)

if __name__ == "__main__":
    # 简单测试：验证配置是否能正常读取
    print(app_config.es.host)
