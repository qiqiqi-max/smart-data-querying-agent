"""
Embedding 客户端管理器

负责按配置初始化 Embedding 服务客户端，并为字段、指标和用户问题的向量化
提供统一访问入口
"""

import asyncio
from typing import Optional

from langchain_huggingface import HuggingFaceEndpointEmbeddings

from app.clients.embedding_client import EmbeddingClient, LocalEmbeddingClient
from app.conf.app_config import EmbeddingConfig, app_config, resolve_project_path


class EmbeddingClientManager:
    """管理 Embedding 服务客户端的初始化与复用"""

    def __init__(self, config: EmbeddingConfig):
        self.client: Optional[EmbeddingClient] = None
        self.config = config

    def _get_url(self) -> str:
        """拼接 Embedding 服务地址"""
        return f"http://{self.config.host}:{self.config.port}"

    def init(self):
        """显式初始化客户端，避免模块导入时立即建立外部连接"""
        try:
            if app_config.local_mode:
                self.client = LocalEmbeddingClient(
                    model_path=resolve_project_path(self.config.model_path),
                    expected_dimension=app_config.qdrant.embedding_size,
                )
            else:
                self.client = HuggingFaceEndpointEmbeddings(model=self._get_url())
        except Exception:
            self.client = None

    async def health_check(self):
        """执行一次真实向量化，确保客户端而不是仅仅对象构造成功。"""

        if self.client is None:
            raise RuntimeError("Embedding 客户端未初始化")
        await self.client.aembed_query("本地 Embedding 健康检查")


# 模块级单例，供整个项目复用同一套 Embedding 客户端管理器
embedding_client_manager = EmbeddingClientManager(app_config.embedding)


if __name__ == "__main__":
    embedding_client_manager.init()
    client = embedding_client_manager.client

    async def test():
        """执行一次最小化向量化调用，验证服务是否可用"""
        text = "What is deep learning?"
        query_result = await client.aembed_query(text)
        print(query_result[:3])

    asyncio.run(test())
