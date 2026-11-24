from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.api.admin_access import AdminRoute, require_local_admin
from app.api.schemas.admin_settings_schema import ModelSettingsInput


def make_app():
    app = FastAPI()
    app.router.route_class = AdminRoute

    @app.get("/admin", dependencies=[Depends(require_local_admin)])
    def get():
        return {"ok": True}

    @app.post("/admin", dependencies=[Depends(require_local_admin)])
    def post(payload: ModelSettingsInput):
        return {"ok": True}

    return app


def test_local_admin_rejects_remote_client_origin_and_dns_rebinding():
    app = make_app()
    with TestClient(
        app, base_url="http://127.0.0.1", client=("127.0.0.1", 5000)
    ) as client:
        assert client.get("/admin").status_code == 200
        assert (
            client.get("/admin", headers={"Origin": "https://evil.example"}).status_code
            == 403
        )
        assert client.get("/admin", headers={"Host": "evil.example"}).status_code == 403
        assert (
            client.get("/admin", headers={"X-Forwarded-For": "10.0.0.4"}).status_code
            == 403
        )
        assert client.post("/admin", data={"model_name": "m"}).status_code == 415
    with TestClient(
        app, base_url="http://127.0.0.1", client=("10.0.0.4", 5000)
    ) as client:
        assert client.get("/admin").status_code == 403


def test_validation_errors_do_not_echo_rejected_secret_input():
    with TestClient(
        make_app(), base_url="http://localhost", client=("127.0.0.1", 5000)
    ) as client:
        response = client.post(
            "/admin",
            json={
                "model_name": "m",
                "base_url": "https://user:canary-secret@example.com",
                "api_key": ["secret-canary-key"],
            },
        )
        assert response.status_code == 422
        assert "canary" not in response.text
        assert "base_url" in response.json()["detail"]
