"""
电商问数 Agent 使用的大模型实例

当前中转站会拦截 OpenAI Python SDK 的请求，所以这里不用 SDK，而是实现一个
轻量 ChatModel，仍然保持 LangChain 的 LCEL 调用方式不变：
- 同步 invoke 走 requests
- 异步 ainvoke 走 httpx.AsyncClient，取消等待中的任务会直接中断 HTTP 请求，
  不会像线程池里的 requests 那样一直跑到超时
"""

from typing import Any

import httpx
import requests
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import ConfigDict, Field, SecretStr
from requests.utils import default_user_agent, get_environ_proxies, select_proxy

from app.conf.app_config import app_config


class RequestsChatModel(BaseChatModel):
    """Use an OpenAI-compatible chat endpoint without the OpenAI SDK."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    model_name: str
    base_url: str
    # SecretStr 让 repr、日志和 model_dump 只显示掩码，真正发请求时再取明文
    api_key: SecretStr
    temperature: float = 0
    timeout: int = 120
    # 测试注入用（如 httpx.MockTransport）；为空时按真实网络和代理配置发请求
    async_transport: httpx.AsyncBaseTransport | None = Field(
        default=None, exclude=True, repr=False
    )

    @property
    def _llm_type(self) -> str:
        return "requests-openai-compatible-chat"

    @property
    def _endpoint(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"

    def _message_to_payload(self, message: BaseMessage) -> dict[str, str]:
        role_map = {
            "human": "user",
            "ai": "assistant",
            "system": "system",
        }
        return {
            "role": role_map.get(message.type, "user"),
            "content": str(message.content),
        }

    def _build_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key.get_secret_value()}",
            "Content-Type": "application/json",
        }

    def _build_body(self, messages: list[BaseMessage]) -> dict[str, Any]:
        return {
            "model": self.model_name,
            "messages": [self._message_to_payload(message) for message in messages],
            "temperature": self.temperature,
        }

    @staticmethod
    def _parse_content(data: dict[str, Any]) -> str:
        return data["choices"][0]["message"]["content"]

    @staticmethod
    def _build_result(content: str, stop: list[str] | None) -> ChatResult:
        if stop:
            for token in stop:
                if token in content:
                    content = content.split(token, 1)[0]
                    break
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content=content))]
        )

    def _resolve_proxy(self) -> str | None:
        """按 requests 的规则（环境变量 + NO_PROXY）选出目标地址要走的代理。

        httpx 的 trust_env 解析 NO_PROXY 里的 "::1" 这类条目会直接报
        InvalidURL，所以异步客户端关闭 trust_env，代理由这里显式指定，
        保证和同步 requests 路径走同一条网络链路。
        """
        proxy = select_proxy(self._endpoint, get_environ_proxies(self._endpoint))
        if proxy and "://" not in proxy:
            # requests 允许省略协议，默认按 http 代理处理
            proxy = f"http://{proxy}"
        return proxy

    def _call_api(self, messages: list[BaseMessage]) -> str:
        response = requests.post(
            self._endpoint,
            headers=self._build_headers(),
            json=self._build_body(messages),
            timeout=self.timeout,
        )
        response.raise_for_status()
        return self._parse_content(response.json())

    async def _acall_api(self, messages: list[BaseMessage]) -> str:
        # 每次调用新建客户端：AsyncClient 的连接池绑定创建时的事件循环，
        # 应用 lifespan、脚本 asyncio.run、测试各自有独立循环，跨循环复用不安全
        client_kwargs: dict[str, Any] = {
            "timeout": self.timeout,
            "trust_env": False,
            "follow_redirects": True,
            # 和 requests 路径保持同样的 UA，避免中转站按 UA 区别对待
            "headers": {"User-Agent": default_user_agent()},
        }
        if self.async_transport is not None:
            client_kwargs["transport"] = self.async_transport
        else:
            client_kwargs["proxy"] = self._resolve_proxy()

        async with httpx.AsyncClient(**client_kwargs) as client:
            response = await client.post(
                self._endpoint,
                headers=self._build_headers(),
                json=self._build_body(messages),
            )
            response.raise_for_status()
            return self._parse_content(response.json())

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._build_result(self._call_api(messages), stop)

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._build_result(await self._acall_api(messages), stop)


# 统一从配置读取模型三件套，节点只复用 llm，不重复初始化模型连接
llm = RequestsChatModel(
    model_name=app_config.llm.model_name,
    base_url=app_config.llm.base_url,
    api_key=app_config.llm.api_key,
    temperature=0,
)

if __name__ == "__main__":
    # 本地快速验证 LLM 配置是否能正常调用
    print(llm.invoke("你好").content)
