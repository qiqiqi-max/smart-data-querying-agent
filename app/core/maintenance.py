"""进程内问数与知识重建互斥；失败后须成功重建才能恢复问数。"""

from contextlib import asynccontextmanager
from threading import RLock

from fastapi import HTTPException


class MaintenanceState:
    def __init__(self):
        self._lock = RLock()
        self._building = False
        self._blocked = False
        self._active_queries = 0

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "building": self._building,
                "blocked": self._blocked,
                "active_queries": self._active_queries,
            }

    def check_query(self) -> None:
        with self._lock:
            if self._blocked:
                raise HTTPException(409, "知识库正在维护，请在成功重建后重新问数")

    @asynccontextmanager
    async def query(self):
        release = self.reserve_query()
        try:
            yield
        finally:
            release()

    def reserve_query(self):
        """Reserve before HTTP response headers; return an idempotent release callback."""
        with self._lock:
            self.check_query()
            self._active_queries += 1
        released = False

        def release():
            nonlocal released
            with self._lock:
                if not released:
                    self._active_queries -= 1
                    released = True

        return release

    def start_build(self) -> None:
        with self._lock:
            if self._building:
                raise HTTPException(409, "已有知识库构建正在运行")
            if self._active_queries:
                raise HTTPException(409, "有问数任务正在运行，请等待完成后重建")
            self._building = True
            self._blocked = True

    def finish_build(self, success: bool) -> None:
        with self._lock:
            self._building = False
            self._blocked = not success


maintenance = MaintenanceState()
