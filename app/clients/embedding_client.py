"""Embedding 客户端协议和本地模型实现。"""

import asyncio
import threading
from pathlib import Path
from typing import Any, Protocol


class EmbeddingClient(Protocol):
    """问数链路需要的最小 Embedding 接口。"""

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def aembed_query(self, text: str) -> list[float]: ...


class LocalEmbeddingClient:
    """直接在本机加载 BGE 模型，避免依赖独立的 Embedding HTTP 服务。"""

    def __init__(self, model_path: Path, expected_dimension: int):
        self.model_path = model_path
        self.expected_dimension = expected_dimension
        self._tokenizer: Any = None
        self._model: Any = None
        self._torch: Any = None
        self._load_lock = threading.RLock()

    def _load_model(self) -> None:
        """首次调用时加载模型，避免模块导入阶段占用大量内存。"""

        if self._model is not None:
            return

        with self._load_lock:
            if self._model is not None:
                return
            if not self.model_path.is_dir():
                raise FileNotFoundError(
                    f"本地 Embedding 模型目录不存在：{self.model_path}"
                )
            try:
                import torch
                from transformers import AutoModel, AutoTokenizer
            except ImportError as exc:
                raise RuntimeError(
                    "本地 Embedding 需要 torch 和 transformers，请先执行 uv sync"
                ) from exc

            self._torch = torch
            self._tokenizer = AutoTokenizer.from_pretrained(
                str(self.model_path), local_files_only=True, use_fast=True
            )
            self._model = AutoModel.from_pretrained(
                str(self.model_path), local_files_only=True
            )
            self._model.eval()

            hidden_size = int(self._model.config.hidden_size)
            if hidden_size != self.expected_dimension:
                raise ValueError(
                    "Embedding 维度不匹配："
                    f"模型输出 {hidden_size}，配置要求 {self.expected_dimension}"
                )

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        with self._load_lock:
            self._load_model()
            torch = self._torch
            encoded = self._tokenizer(
                [text.replace("\n", " ") for text in texts],
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            with torch.inference_mode():
                outputs = self._model(**encoded)
                hidden = outputs.last_hidden_state
                mask = encoded["attention_mask"].unsqueeze(-1).to(hidden.dtype)
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
                normalized = torch.nn.functional.normalize(pooled, p=2, dim=1)
            return normalized.cpu().tolist()

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self._embed_sync, texts)

    async def aembed_query(self, text: str) -> list[float]:
        vectors = await self.aembed_documents([text])
        return vectors[0]
