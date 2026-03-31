"""
Sub2API 账号上传功能
将账号批量导入到 Sub2API / NewAPI 平台
"""

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from curl_cffi import requests as cffi_requests

from core.db import AccountModel

logger = logging.getLogger(__name__)


def _build_headers(api_key: str) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-api-key": api_key,
    }


def _parse_response_data(response) -> Any:
    payload = response.json()
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


# ── 连接测试 ──────────────────────────────────────────────

def test_sub2api_connection(api_url: str, api_key: str) -> Tuple[bool, str]:
    if not api_url:
        return False, "API URL 不能为空"
    if not api_key:
        return False, "API Key 不能为空"

    url = api_url.rstrip("/") + "/api/v1/admin/accounts/data"
    headers = {"x-api-key": api_key}

    try:
        response = cffi_requests.get(
            url,
            headers=headers,
            proxies=None,
            timeout=10,
            impersonate="chrome110",
        )
        if response.status_code in (200, 201, 204, 405):
            return True, "Sub2API 连接测试成功"
        if response.status_code == 401:
            return False, "连接成功，但 API Key 无效"
        if response.status_code == 403:
            return False, "连接成功，但权限不足"
        return False, f"服务器返回异常状态码: {response.status_code}"
    except cffi_requests.exceptions.ConnectionError as e:
        return False, f"无法连接到服务器: {e}"
    except cffi_requests.exceptions.Timeout:
        return False, "连接超时，请检查网络配置"
    except Exception as e:
        return False, f"连接测试失败: {e}"


# ── 拉取分组列表 ──────────────────────────────────────────

def fetch_sub2api_groups(
    api_url: str,
    api_key: str,
    platform: str = "openai",
) -> Tuple[bool, str, List[dict]]:
    if not api_url:
        return False, "API URL 不能为空", []
    if not api_key:
        return False, "API Key 不能为空", []

    base_url = api_url.rstrip("/")
    headers = _build_headers(api_key)
    endpoints = [
        ("/api/v1/admin/groups/all", {"platform": platform}),
        ("/api/v1/admin/groups", {"platform": platform, "page": 1, "page_size": 1000}),
    ]

    last_error = "拉取分组失败"
    for path, params in endpoints:
        try:
            response = cffi_requests.get(
                base_url + path,
                headers=headers,
                params=params,
                proxies=None,
                timeout=15,
                impersonate="chrome110",
            )
            if response.status_code not in (200, 201):
                last_error = f"服务器返回异常状态码: {response.status_code}"
                continue

            data = _parse_response_data(response)
            if isinstance(data, dict):
                items = data.get("items") or data.get("list") or []
            elif isinstance(data, list):
                items = data
            else:
                items = []

            groups: List[dict] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                group_id = item.get("id")
                try:
                    group_id = int(group_id)
                except (TypeError, ValueError):
                    continue
                groups.append({
                    "id": group_id,
                    "name": str(item.get("name") or f"Group {group_id}"),
                    "platform": str(item.get("platform") or ""),
                    "status": str(item.get("status") or ""),
                    "account_count": int(item.get("account_count") or 0),
                })
            return True, "分组拉取成功", groups
        except Exception as exc:
            last_error = f"拉取分组失败: {exc}"

    return False, last_error, []


# ── 搜索远端账号 ──────────────────────────────────────────

def _search_remote_account(
    api_url: str,
    api_key: str,
    account_name: str,
    platform: str = "openai",
) -> Optional[dict]:
    base_url = api_url.rstrip("/")
    headers = _build_headers(api_key)

    for attempt in range(3):
        try:
            response = cffi_requests.get(
                base_url + "/api/v1/admin/accounts",
                headers=headers,
                params={
                    "page": 1,
                    "page_size": 20,
                    "platform": platform,
                    "search": account_name,
                },
                proxies=None,
                timeout=20,
                impersonate="chrome110",
            )
            if response.status_code not in (200, 201):
                continue

            data = _parse_response_data(response)
            items = data.get("items", []) if isinstance(data, dict) else []
            normalized = str(account_name or "").strip().lower()

            for item in items:
                if not isinstance(item, dict):
                    continue
                remote_name = str(item.get("name") or "").strip().lower()
                remote_email = str(
                    (item.get("credentials") or {}).get("email") or ""
                ).strip().lower()
                if normalized and normalized in {remote_name, remote_email}:
                    return item
        except Exception:
            pass
        if attempt < 2:
            time.sleep(1.0)
    return None


# ── 远端分组绑定 ──────────────────────────────────────────

def _update_remote_groups(
    api_url: str,
    api_key: str,
    remote_account_id: int,
    group_ids: List[int],
) -> Tuple[bool, str]:
    base_url = api_url.rstrip("/")
    headers = _build_headers(api_key)

    try:
        response = cffi_requests.put(
            f"{base_url}/api/v1/admin/accounts/{remote_account_id}",
            json={"group_ids": group_ids},
            headers=headers,
            proxies=None,
            timeout=20,
            impersonate="chrome110",
        )
        if response.status_code in (200, 201):
            return True, "分组绑定成功"
        error_msg = f"分组绑定失败: HTTP {response.status_code}"
        try:
            detail = response.json()
            if isinstance(detail, dict):
                error_msg = detail.get("message", error_msg)
        except Exception:
            error_msg = f"{error_msg} - {response.text[:200]}"
        return False, error_msg
    except Exception as exc:
        logger.error("Sub2API 分组绑定异常: %s", exc)
        return False, f"分组绑定异常: {exc}"


# ── 平台名映射 ──────────────────────────────────────────

PLATFORM_MAP = {
    "chatgpt": "openai",
    "trae": "openai",
    "cursor": "openai",
    "kiro": "openai",
    "grok": "openai",
}


def _map_platform(platform: str) -> str:
    return PLATFORM_MAP.get(platform, "openai")


# ── 构建账号条目 ──────────────────────────────────

def _build_account_item(
    acc: AccountModel,
    concurrency: int = 3,
    priority: int = 50,
) -> Optional[dict]:
    """将本地 AccountModel 转为 Sub2API 导入格式。"""
    extra = acc.get_extra()
    access_token = extra.get("access_token") or acc.token
    if not access_token:
        return None

    return {
        "name": acc.email,
        "platform": _map_platform(acc.platform),
        "type": "oauth",
        "credentials": {
            "access_token": access_token,
            "refresh_token": extra.get("refresh_token", ""),
            "email": acc.email,
        },
        "extra": {},
        "concurrency": concurrency,
        "priority": priority,
        "rate_multiplier": 1,
        "auto_pause_on_expired": True,
    }


# ── 批量上传 ──────────────────────────────────────────────

def upload_to_sub2api(
    accounts: List[AccountModel],
    api_url: str,
    api_key: str,
    concurrency: int = 3,
    priority: int = 50,
    target_type: str = "sub2api",
) -> Tuple[bool, str]:
    if not accounts:
        return False, "无可上传的账号"
    if not api_url:
        return False, "Sub2API URL 未配置"
    if not api_key:
        return False, "Sub2API API Key 未配置"

    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    account_items = []
    for acc in accounts:
        item = _build_account_item(acc, concurrency, priority)
        if item:
            account_items.append(item)

    if not account_items:
        return False, "所有账号均缺少 access_token，无法上传"

    payload = {
        "data": {
            "type": "newapi-data" if str(target_type).lower() == "newapi" else "sub2api-data",
            "version": 1,
            "exported_at": exported_at,
            "proxies": [],
            "accounts": account_items,
        },
        "skip_default_group_bind": True,
    }

    url = api_url.rstrip("/") + "/api/v1/admin/accounts/data"
    headers = _build_headers(api_key)
    headers["Idempotency-Key"] = f"import-{exported_at}"

    try:
        response = cffi_requests.post(
            url,
            json=payload,
            headers=headers,
            proxies=None,
            timeout=30,
            impersonate="chrome110",
        )
        if response.status_code in (200, 201):
            return True, f"成功上传 {len(account_items)} 个账号"

        error_msg = f"上传失败: HTTP {response.status_code}"
        try:
            detail = response.json()
            if isinstance(detail, dict):
                error_msg = detail.get("message", error_msg)
        except Exception:
            error_msg = f"{error_msg} - {response.text[:200]}"
        return False, error_msg
    except Exception as e:
        logger.error("Sub2API 上传异常: %s", e)
        return False, f"上传异常: {e}"


# ── 批量同步（含分组绑定） ────────────────────────────────

def batch_sync_to_sub2api(
    account_ids: List[int],
    api_url: str,
    api_key: str,
    group_id: Optional[int] = None,
    concurrency: int = 3,
    priority: int = 50,
    target_type: str = "sub2api",
) -> dict:
    """
    批量同步指定 ID 的账号到 Sub2API 平台

    Returns:
        包含成功/失败/跳过统计和详情的字典
    """
    from sqlmodel import Session, select
    from core.db import engine

    results: Dict[str, Any] = {
        "success_count": 0,
        "failed_count": 0,
        "skipped_count": 0,
        "details": [],
    }

    with Session(engine) as session:
        accounts: List[AccountModel] = []
        for aid in account_ids:
            acc = session.get(AccountModel, aid)
            if not acc:
                results["failed_count"] += 1
                results["details"].append(
                    {"id": aid, "email": None, "success": False, "error": "账号不存在"}
                )
                continue
            extra = acc.get_extra()
            if not (extra.get("access_token") or acc.token):
                results["skipped_count"] += 1
                results["details"].append(
                    {"id": aid, "email": acc.email, "success": False, "error": "缺少 access_token"}
                )
                continue
            accounts.append(acc)

        if not accounts:
            return results

        ok, msg = upload_to_sub2api(
            accounts, api_url, api_key, concurrency, priority, target_type,
        )

        if ok:
            for acc in accounts:
                bind_msg = msg
                if group_id:
                    remote = _search_remote_account(
                        api_url, api_key, acc.email, _map_platform(acc.platform),
                    )
                    if remote:
                        existing_ids: List[int] = []
                        for v in remote.get("group_ids") or []:
                            try:
                                existing_ids.append(int(v))
                            except (TypeError, ValueError):
                                continue
                        merged = sorted(set(existing_ids + [int(group_id)]))
                        bind_ok, bind_err = _update_remote_groups(
                            api_url, api_key, int(remote["id"]), merged,
                        )
                        if not bind_ok:
                            results["failed_count"] += 1
                            results["details"].append({
                                "id": acc.id, "email": acc.email,
                                "success": False,
                                "error": f"上传成功，但分组绑定失败: {bind_err}",
                            })
                            continue
                        bind_msg = f"{msg}，并已绑定分组"

                results["success_count"] += 1
                results["details"].append({
                    "id": acc.id, "email": acc.email,
                    "success": True, "message": bind_msg,
                })
        else:
            for acc in accounts:
                results["failed_count"] += 1
                results["details"].append({
                    "id": acc.id, "email": acc.email,
                    "success": False, "error": msg,
                })

    return results


def sync_all_platform_to_sub2api(
    platform: str,
    api_url: str,
    api_key: str,
    group_id: Optional[int] = None,
    concurrency: int = 3,
    priority: int = 50,
    target_type: str = "sub2api",
) -> dict:
    """同步指定平台的所有账号到 Sub2API"""
    from sqlmodel import Session, select
    from core.db import engine

    with Session(engine) as session:
        q = select(AccountModel)
        if platform:
            q = q.where(AccountModel.platform == platform)
        accounts = session.exec(q).all()
        ids = [acc.id for acc in accounts if acc.id is not None]

    if not ids:
        return {
            "success_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "details": [],
        }

    return batch_sync_to_sub2api(
        ids, api_url, api_key, group_id, concurrency, priority, target_type,
    )
