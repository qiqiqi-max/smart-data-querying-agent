"""Restrict the single-user local console and keep validation errors secret-free."""

import ipaddress
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute


def is_loopback(host: str | None) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host or "").is_loopback
    except ValueError:
        return False


async def require_local_admin(request: Request):
    if (
        not is_loopback(request.url.hostname)
        or not request.client
        or not is_loopback(request.client.host)
    ):
        raise HTTPException(403, "管理台仅允许本机访问。")
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and not all(
        is_loopback(host.strip()) for host in forwarded.split(",")
    ):
        raise HTTPException(403, "管理台仅允许本机访问。")
    origin = request.headers.get("origin")
    if origin:
        try:
            parsed = urlsplit(origin)
            valid = parsed.scheme in {"http", "https"} and is_loopback(parsed.hostname)
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(403, "管理请求来源不受信任。")
    if (
        request.method in {"POST", "PUT", "PATCH"}
        and request.headers.get("content-type", "").split(";")[0] != "application/json"
    ):
        raise HTTPException(415, "管理操作需要 JSON 请求。")


class AdminRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                # FastAPI's normal response includes rejected input; credentials must not be echoed.
                fields = [
                    ".".join(str(part) for part in error["loc"][1:])
                    for error in exc.errors()
                ]
                return JSONResponse(
                    status_code=422,
                    content={
                        "detail": "输入格式有误，请检查："
                        + "、".join(dict.fromkeys(fields))
                    },
                )

        return handle
