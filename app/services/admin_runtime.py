"""Application-scoped administration services, sharing the active clients."""

from app.conf.app_config import app_config, project_root, resolve_project_path
from app.services.admin_audit import AdminAudit
from app.services.admin_knowledge import AdminKnowledgeService
from app.services.admin_settings import AdminSettingsService

state_dir = resolve_project_path(app_config.local_data_dir) / "admin"
settings_service = AdminSettingsService(state_dir / "settings.json", app_config)
knowledge_service = AdminKnowledgeService(
    project_root / "conf" / "meta_config.yaml", state_dir
)
audit = AdminAudit(state_dir / "audit.json")
knowledge_service.on_complete = lambda build: audit.record(
    "knowledge.build.finished", build["status"], build["error"] or "知识库重建完成。"
)
