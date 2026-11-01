"""
电商问数 Agent 使用的大模型实例

当前中转站会拦截 OpenAI Python SDK 的请求，所以这里使用 requests
实现一个轻量 ChatModel，仍然保持 LangChain 的 LCEL 调用方式不变。
"""

from typing import Any

import requests
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import ConfigDict

from app.conf.app_config import app_config


class RequestsChatModel(BaseChatModel):
    """Use an OpenAI-compatible chat endpoint without the OpenAI SDK."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    model_name: str
    base_url: str
    api_key: str
    temperature: float = 0
    timeout: int = 120

    @property
    def _llm_type(self) -> str:
        return "requests-openai-compatible-chat"

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

    def _call_api(self, messages: list[BaseMessage]) -> str:
        response = requests.post(
            f"{self.base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model_name,
                "messages": [self._message_to_payload(message) for message in messages],
                "temperature": self.temperature,
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return data["choices"][0]["message"]["content"]

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        content = self._call_api(messages)
        if stop:
            for token in stop:
                if token in content:
                    content = content.split(token, 1)[0]
                    break
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content=content))]
        )


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
