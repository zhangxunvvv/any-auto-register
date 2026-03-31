from __future__ import annotations

from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from core.base_platform import Account, AccountStatus
from core.db import AccountModel, engine
from services.external_apps import install, list_status, start, start_all, stop, stop_all

router = APIRouter(prefix="/integrations", tags=["integrations"])


class BackfillRequest(BaseModel):
    platforms: list[str] = Field(default_factory=lambda: ["grok", "kiro"])


class Sub2APISyncRequest(BaseModel):
    account_ids: List[int] = Field(default_factory=list)
    platform: Optional[str] = None
    group_id: Optional[int] = None
    concurrency: int = 3
    priority: int = 50
    target_type: str = "sub2api"


class Sub2APITestRequest(BaseModel):
    api_url: str
    api_key: str


def _to_account(model: AccountModel) -> Account:
    return Account(
        platform=model.platform,
        email=model.email,
        password=model.password,
        user_id=model.user_id,
        region=model.region,
        token=model.token,
        status=AccountStatus(model.status),
        extra=model.get_extra(),
    )


@router.get("/services")
def get_services():
    return {"items": list_status()}


@router.post("/services/start-all")
def start_all_services():
    return {"items": start_all()}


@router.post("/services/stop-all")
def stop_all_services():
    return {"items": stop_all()}


@router.post("/services/{name}/start")
def start_service(name: str):
    return start(name)


@router.post("/services/{name}/install")
def install_service(name: str):
    return install(name)


@router.post("/services/{name}/stop")
def stop_service(name: str):
    return stop(name)


@router.post("/backfill")
def backfill_integrations(body: BackfillRequest):
    summary = {"total": 0, "success": 0, "failed": 0, "items": []}
    targets = set(body.platforms or [])

    if "grok" in targets:
        from services.grok2api_runtime import ensure_grok2api_ready

        ok, msg = ensure_grok2api_ready()
        if not ok:
            return {
                "total": 0,
                "success": 0,
                "failed": 0,
                "items": [{"platform": "grok", "email": "", "results": [{"name": "grok2api", "ok": False, "msg": msg}]}],
            }

    with Session(engine) as s:
        rows = s.exec(
            select(AccountModel).where(AccountModel.platform.in_(targets))
        ).all()

    for row in rows:
        item = {"platform": row.platform, "email": row.email, "results": []}
        try:
            account = _to_account(row)
            results = []
            if row.platform == "grok":
                from core.config_store import config_store
                from platforms.grok.grok2api_upload import upload_to_grok2api

                api_url = str(config_store.get("grok2api_url", "") or "").strip() or "http://127.0.0.1:8011"
                app_key = str(config_store.get("grok2api_app_key", "") or "").strip() or "grok2api"
                ok, msg = upload_to_grok2api(account, api_url=api_url, app_key=app_key)
                results.append({"name": "grok2api", "ok": ok, "msg": msg})

            elif row.platform == "kiro":
                from core.config_store import config_store
                from platforms.kiro.account_manager_upload import upload_to_kiro_manager

                configured_path = str(config_store.get("kiro_manager_path", "") or "").strip() or None
                ok, msg = upload_to_kiro_manager(account, path=configured_path)
                results.append({"name": "Kiro Manager", "ok": ok, "msg": msg})

            if not results:
                item["results"].append({"name": "skip", "ok": False, "msg": "未配置对应导入目标"})
                summary["failed"] += 1
            else:
                item["results"] = results
                if all(r.get("ok") for r in results):
                    summary["success"] += 1
                else:
                    summary["failed"] += 1
        except Exception as e:
            item["results"].append({"name": "error", "ok": False, "msg": str(e)})
            summary["failed"] += 1
        summary["items"].append(item)
        summary["total"] += 1

    return summary


# ── Sub2API 集成 ──────────────────────────────────────────

@router.post("/sub2api/test")
def test_sub2api(body: Sub2APITestRequest):
    """测试 Sub2API 连接"""
    from services.sub2api_upload import test_sub2api_connection

    ok, msg = test_sub2api_connection(body.api_url, body.api_key)
    return {"ok": ok, "message": msg}


@router.get("/sub2api/groups")
def get_sub2api_groups(platform: str = "openai"):
    """拉取 Sub2API 分组列表"""
    from core.config_store import config_store
    from services.sub2api_upload import fetch_sub2api_groups

    api_url = str(config_store.get("sub2api_url", "") or "").strip()
    api_key = str(config_store.get("sub2api_key", "") or "").strip()
    if not api_url or not api_key:
        raise HTTPException(400, "Sub2API URL 或 API Key 未配置")

    ok, msg, groups = fetch_sub2api_groups(api_url, api_key, platform)
    return {"ok": ok, "message": msg, "groups": groups}


@router.post("/sub2api/sync")
def sync_to_sub2api(body: Sub2APISyncRequest):
    """
    同步账号到 Sub2API。
    - 传 account_ids: 同步指定账号
    - 传 platform 且不传 account_ids: 同步该平台所有账号
    """
    from core.config_store import config_store
    from services.sub2api_upload import batch_sync_to_sub2api, sync_all_platform_to_sub2api

    api_url = str(config_store.get("sub2api_url", "") or "").strip()
    api_key = str(config_store.get("sub2api_key", "") or "").strip()
    if not api_url or not api_key:
        raise HTTPException(400, "Sub2API URL 或 API Key 未配置")

    group_id = body.group_id
    if group_id is None:
        raw = config_store.get("sub2api_default_group_id", "")
        if raw:
            try:
                group_id = int(raw)
            except (TypeError, ValueError):
                pass

    target_type = body.target_type or str(config_store.get("sub2api_target_type", "sub2api") or "sub2api")

    if body.account_ids:
        result = batch_sync_to_sub2api(
            body.account_ids, api_url, api_key,
            group_id=group_id,
            concurrency=body.concurrency,
            priority=body.priority,
            target_type=target_type,
        )
    elif body.platform:
        result = sync_all_platform_to_sub2api(
            body.platform, api_url, api_key,
            group_id=group_id,
            concurrency=body.concurrency,
            priority=body.priority,
            target_type=target_type,
        )
    else:
        raise HTTPException(400, "请指定 account_ids 或 platform")

    return result
