"""外部系统同步（自动导入 / 回填）"""

from __future__ import annotations

from typing import Any


def sync_account(account, skip_sub2api: bool = False) -> list[dict[str, Any]]:
    """根据平台将账号同步到外部系统。"""
    from core.config_store import config_store

    platform = getattr(account, "platform", "")
    results: list[dict[str, Any]] = []

    if platform == "chatgpt":
        cpa_url = config_store.get("cpa_api_url", "")
        if cpa_url:
            from platforms.chatgpt.cpa_upload import generate_token_json, upload_to_cpa

            class _A:
                pass

            a = _A()
            a.email = account.email
            extra = account.extra or {}
            a.access_token = extra.get("access_token") or account.token
            a.refresh_token = extra.get("refresh_token", "")
            a.id_token = extra.get("id_token", "")

            ok, msg = upload_to_cpa(generate_token_json(a))
            results.append({"name": "CPA", "ok": ok, "msg": msg})

    elif platform == "grok":
        grok2api_url = str(config_store.get("grok2api_url", "") or "").strip()
        if grok2api_url:
            from services.grok2api_runtime import ensure_grok2api_ready
            from platforms.grok.grok2api_upload import upload_to_grok2api

            ready, ready_msg = ensure_grok2api_ready()
            if not ready:
                results.append({"name": "grok2api", "ok": False, "msg": ready_msg})
                return results

            ok, msg = upload_to_grok2api(account)
            results.append({"name": "grok2api", "ok": ok, "msg": msg})

    elif platform == "kiro":
        from platforms.kiro.account_manager_upload import resolve_manager_path, upload_to_kiro_manager

        configured_path = str(config_store.get("kiro_manager_path", "") or "").strip()
        target_path = resolve_manager_path(configured_path or None)
        if configured_path or target_path.parent.exists() or target_path.exists():
            ok, msg = upload_to_kiro_manager(account, path=configured_path or None)
            results.append({"name": "Kiro Manager", "ok": ok, "msg": msg})

    # Sub2API 自动同步（所有平台通用）
    # 当注册任务指定了 sub_sync_mode=each/batch 时跳过自动同步，由任务自行处理
    sub2api_url = str(config_store.get("sub2api_url", "") or "").strip()
    sub2api_key = str(config_store.get("sub2api_key", "") or "").strip()
    if sub2api_url and sub2api_key and not skip_sub2api:
        try:
            from core.db import AccountModel
            from sqlmodel import Session, select
            from core.db import engine as _engine
            from services.sub2api_upload import upload_to_sub2api

            with Session(_engine) as _s:
                db_acc = _s.exec(
                    select(AccountModel)
                    .where(AccountModel.platform == platform)
                    .where(AccountModel.email == str(getattr(account, "email", "")))
                ).first()
                if db_acc:
                    target_type = str(config_store.get("sub2api_target_type", "sub2api") or "sub2api")
                    ok, msg = upload_to_sub2api([db_acc], sub2api_url, sub2api_key, target_type=target_type)
                    results.append({"name": "Sub2API", "ok": ok, "msg": msg})
        except Exception as exc:
            results.append({"name": "Sub2API", "ok": False, "msg": str(exc)})

    return results
