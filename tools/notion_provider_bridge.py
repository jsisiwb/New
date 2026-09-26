#!/usr/bin/env python3
"""
Notion AI Provider Bridge Service for Yeonjae Studio.

Exposes a local HTTP server speaking the /v1/complete protocol expected by
@yeonjae/gateway HttpProvider, backed by notion_ai_auth.py.

Multi-Workspace Features:
- Automatically detects all Notion workspaces in the authenticated account.
- Pools workspaces with automatic round-robin load balancing.
- Doubles capacity (each Business trial workspace gets 100 credits/6h = 200 total).
- Seamless automatic failover: if workspace 1 is rate-limited, instantly retries on workspace 2.
- Supports targeted workspace models (e.g. 'notion-ai-1', 'notion-ai-2') or auto ('notion-ai').
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import signal
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Locate and import notion_ai_auth
NOTION_AUTH_DIRS = [
    "/home/ubuntu",
    os.path.dirname(os.path.abspath(__file__)),
]

notion_ai_auth = None
for d in NOTION_AUTH_DIRS:
    if os.path.isdir(d) and d not in sys.path:
        sys.path.insert(0, d)
    try:
        import notion_ai_auth as _n_auth  # type: ignore
        notion_ai_auth = _n_auth
        break
    except ImportError:
        continue

if notion_ai_auth is None:
    raise RuntimeError(f"Could not import notion_ai_auth from any of: {NOTION_AUTH_DIRS}")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [notion-bridge] %(message)s",
)
logger = logging.getLogger("notion_bridge")

_in_flight_locks: Dict[str, threading.Event] = {}
_in_flight_mutex = threading.Lock()
DEFAULT_MODEL = "notion-ai"


def _sha256(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()[:16]


_FENCE_RX = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _extract_json(text: str) -> Optional[Any]:
    raw = (text or "").strip()
    if not raw:
        return None
    candidates = [raw]
    for m in _FENCE_RX.findall(raw):
        candidates.append(m.strip())
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        candidates.append(raw[first_brace:last_brace + 1])
    for c in candidates:
        try:
            return json.loads(c, strict=False)
        except Exception:
            pass
        try:
            cleaned = re.sub(r",\s*([\]}])", r"\1", c)
            return json.loads(cleaned, strict=False)
        except Exception:
            pass
    return None


DISCARD_THRESHOLD = float(os.getenv("NOTION_MONTHLY_DISCARD_THRESHOLD", "99.0"))
DISCARDED_SPACES_FILE = Path(os.path.expanduser("~/.notion_discarded_spaces.json"))


def load_discarded_spaces() -> set:
    if DISCARDED_SPACES_FILE.exists():
        try:
            data = json.loads(DISCARDED_SPACES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return set(data)
        except Exception:
            pass
    return set()


def record_discarded_space(slot_key: str) -> None:
    current = load_discarded_spaces()
    if slot_key not in current:
        current.add(slot_key)
        try:
            DISCARDED_SPACES_FILE.write_text(json.dumps(sorted(list(current)), indent=2), encoding="utf-8")
            logger.info("Persisted permanently discarded workspace slot: %s to %s", slot_key, DISCARDED_SPACES_FILE)
        except Exception as e:
            logger.error("Failed to persist discarded workspace slot %s: %s", slot_key, e)


class WorkspaceInfo:
    def __init__(
        self,
        index: int,
        space_id: str,
        user_id: str,
        name: str,
        plan: str,
        tier: str,
        token_file: Optional[str] = None,
        account_email: str = ""
    ):
        self.index = index
        self.space_id = space_id
        self.user_id = user_id
        self.slot_key = f"{space_id}_{user_id}"
        self.name = name
        self.plan = plan
        self.tier = tier
        self.token_file = token_file
        self.account_email = account_email
        self.rate_limited = False
        self.cooldown_until = 0.0
        self.completed_requests = 0
        self.failed_requests = 0
        self.monthly_used = 0.0
        self.monthly_limit = 100.0
        self.monthly_exhausted = self.slot_key in load_discarded_spaces()
        self.last_usage_check = 0.0

    def update_usage(self, rate_limits_dict: Dict[str, Any]) -> None:
        self.last_usage_check = time.time()
        bw = rate_limits_dict.get("billingPeriodWindow", {})
        used = bw.get("used")
        limit = bw.get("limit")
        if used is not None:
            try:
                self.monthly_used = float(used)
            except (ValueError, TypeError):
                pass
        if limit is not None:
            try:
                self.monthly_limit = float(limit)
            except (ValueError, TypeError):
                pass

        # If already permanently discarded, stay discarded
        if self.monthly_exhausted or self.slot_key in load_discarded_spaces():
            self.monthly_exhausted = True
            return

        if self.monthly_used >= DISCARD_THRESHOLD:
            self.monthly_exhausted = True
            record_discarded_space(self.slot_key)
            logger.warning(
                "Workspace %d (%s, %s) reached monthly usage %.2f/%.2f (>= %.1f); PERMANENTLY DISCARDED (never to be renewed).",
                self.index, self.space_id[:8], self.account_email, self.monthly_used, self.monthly_limit, DISCARD_THRESHOLD
            )

    def is_available(self) -> bool:
        if self.monthly_exhausted:
            return False
        if not self.rate_limited:
            return True
        if time.time() >= self.cooldown_until:
            self.rate_limited = False
            self.cooldown_until = 0.0
            return True
        return False

    def mark_rate_limited(self, cooldown_seconds: float = 300.0) -> None:
        self.rate_limited = True
        self.cooldown_until = time.time() + cooldown_seconds

    def to_dict(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "space_id": self.space_id,
            "name": self.name,
            "plan": self.plan,
            "tier": self.tier,
            "account_email": self.account_email,
            "monthly_used": self.monthly_used,
            "monthly_limit": self.monthly_limit,
            "monthly_exhausted": self.monthly_exhausted,
            "discarded": self.monthly_exhausted,
            "rate_limited": not self.is_available(),
            "cooldown_remaining_sec": max(0, int(self.cooldown_until - time.time())) if self.rate_limited else 0,
            "completed_requests": self.completed_requests,
            "failed_requests": self.failed_requests,
        }


class WorkspacePool:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.workspaces: List[WorkspaceInfo] = []
        self._rr_index = 0
        self.refresh()
        self._monitor_thread = threading.Thread(target=self._usage_monitor_loop, daemon=True)
        self._monitor_thread.start()

    def sync_usage(self) -> None:
        try:
            limits_data = notion_ai_auth.get_rate_limits()
            raw_ws_limits = {(w["space_id"], w.get("user_id")): w.get("rate_limits", {}) for w in limits_data.get("workspaces", [])}
            with self.lock:
                for ws in self.workspaces:
                    key = (ws.space_id, ws.user_id)
                    if key in raw_ws_limits:
                        ws.update_usage(raw_ws_limits[key])
                    elif ws.space_id in {w["space_id"]: w.get("rate_limits", {}) for w in limits_data.get("workspaces", [])}:
                        ws.update_usage({w["space_id"]: w.get("rate_limits", {}) for w in limits_data.get("workspaces", [])}[ws.space_id])
        except Exception as e:
            logger.warning("Could not sync usage across workspaces: %s", e)

    def _usage_monitor_loop(self) -> None:
        while True:
            time.sleep(60)
            self.sync_usage()

    def refresh(self) -> None:
        with self.lock:
            try:
                raw_spaces = notion_ai_auth.get_workspaces()
                existing_map = {(ws.space_id, ws.user_id): ws for ws in self.workspaces}
                new_list = []
                for idx, s in enumerate(raw_spaces, start=1):
                    sid = s["space_id"]
                    uid = s["user_id"]
                    token_file = s.get("token_file")
                    account_email = s.get("account_email", "")
                    key = (sid, uid)
                    if key in existing_map:
                        ws = existing_map[key]
                        ws.index = idx
                        ws.name = s.get("name") or f"Workspace {idx}"
                        ws.token_file = token_file
                        ws.account_email = account_email
                        new_list.append(ws)
                    else:
                        new_list.append(WorkspaceInfo(
                            index=idx,
                            space_id=sid,
                            user_id=uid,
                            name=s.get("name") or f"Workspace {idx}",
                            plan=s.get("plan", ""),
                            tier=s.get("tier", ""),
                            token_file=token_file,
                            account_email=account_email,
                        ))
                self.workspaces = new_list
                logger.info("WorkspacePool initialized with %d workspaces across accounts", len(self.workspaces))
            except Exception as e:
                logger.error("Failed to refresh WorkspacePool: %s", e)
        self.sync_usage()

    def select(self, preference: Optional[str] = None) -> Optional[WorkspaceInfo]:
        with self.lock:
            if not self.workspaces:
                self.refresh()
            if not self.workspaces:
                return None

            pref = (preference or "").lower().strip()
            # If explicit workspace requested by index, name, or space_id
            if pref:
                for ws in self.workspaces:
                    if (pref in (str(ws.index), f"notion-ai-{ws.index}", f"notion-ws-{ws.index}", f"ws-{ws.index}", f"workspace-{ws.index}")
                        or pref == ws.space_id.lower()):
                        if not ws.monthly_exhausted:
                            return ws
                        logger.warning(
                            "Requested Workspace %d is discarded due to monthly limit (%.2f >= %.1f). Falling back to auto-pool.",
                            ws.index, ws.monthly_used, DISCARD_THRESHOLD
                        )

            # Otherwise round-robin over available (not rate-limited AND not monthly-exhausted)
            available = [ws for ws in self.workspaces if ws.is_available()]
            if not available:
                # Check if there are workspaces that are only temporary 6h rate-limited (not monthly exhausted)
                non_exhausted = [ws for ws in self.workspaces if not ws.monthly_exhausted]
                if non_exhausted:
                    return min(non_exhausted, key=lambda w: w.cooldown_until)
                logger.error("ALL workspaces in pool are monthly exhausted (usage >= %.1f)!", DISCARD_THRESHOLD)
                return min(self.workspaces, key=lambda w: w.cooldown_until)

            ws = available[self._rr_index % len(available)]
            self._rr_index = (self._rr_index + 1) % len(available)
            return ws

    def get_fallbacks(self, failed_ws: WorkspaceInfo) -> List[WorkspaceInfo]:
        with self.lock:
            candidates = [
                ws for ws in self.workspaces
                if (ws.space_id, ws.user_id) != (failed_ws.space_id, failed_ws.user_id) and ws.is_available()
            ]
            if candidates:
                return candidates
            return [
                ws for ws in self.workspaces
                if (ws.space_id, ws.user_id) != (failed_ws.space_id, failed_ws.user_id) and not ws.monthly_exhausted
            ]

    def get_fallback(self, failed_ws: WorkspaceInfo) -> Optional[WorkspaceInfo]:
        fallbacks = self.get_fallbacks(failed_ws)
        return fallbacks[0] if fallbacks else None


_workspace_pool = WorkspacePool()


class NotionBridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_json(self, status: int, data: Any) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            logger.warning("Client disconnected before response could be sent")

    def _check_auth(self) -> bool:
        expected = os.getenv("NOTION_BRIDGE_TOKEN") or os.getenv("GENSPARK_BRIDGE_TOKEN")
        if not expected:
            return True
        auth_header = self.headers.get("Authorization", "")
        if auth_header == f"Bearer {expected}":
            return True
        self._send_json(401, {"error": "unauthorized", "message": "Missing or invalid Bearer token"})
        return False

    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path == "/health":
            workspaces_health = []
            try:
                limits_data = notion_ai_auth.get_rate_limits()
                raw_ws_limits = {
                    (w["space_id"], w.get("user_id")): w
                    for w in limits_data.get("workspaces", [])
                }
                for ws in _workspace_pool.workspaces:
                    wdict = ws.to_dict()
                    wlimit = raw_ws_limits.get((ws.space_id, ws.user_id)) or raw_ws_limits.get(ws.space_id, {})
                    wdict["rate_limits"] = wlimit.get("rate_limits", {})
                    wdict["usage"] = wlimit.get("usage", {})
                    wdict["limits"] = wlimit.get("limits", {})
                    workspaces_health.append(wdict)
            except Exception as e:
                logger.warning("Could not fetch Notion AI rate limits: %s", e)
                workspaces_health = [ws.to_dict() for ws in _workspace_pool.workspaces]

            models_list = [DEFAULT_MODEL]
            for ws in _workspace_pool.workspaces:
                models_list.append(f"notion-ai-{ws.index}")
                models_list.append(f"notion-ws-{ws.index}")

            active_count = len([w for w in workspaces_health if not w.get("discarded")])
            discarded_count = len([w for w in workspaces_health if w.get("discarded")])

            self._send_json(200, {
                "status": "ok",
                "provider": "notion",
                "strategy": "round_robin_with_failover",
                "workspaces_count": len(_workspace_pool.workspaces),
                "active_workspaces_count": active_count,
                "discarded_workspaces_count": discarded_count,
                "monthly_discard_threshold": DISCARD_THRESHOLD,
                "default_model": DEFAULT_MODEL,
                "models": models_list,
                "workspaces": workspaces_health,
            })
            return

        if path == "/v1/models":
            models = [
                {"id": "notion-ai", "name": "Notion AI (Universal / Auto Pool across all workspaces)", "provider": "notion"},
            ]
            for ws in _workspace_pool.workspaces:
                acc_label = f" [{ws.account_email}]" if ws.account_email else ""
                models.append({
                    "id": f"notion-ai-{ws.index}",
                    "name": f"Notion AI (Workspace {ws.index}: {ws.name}{acc_label})",
                    "provider": "notion"
                })
            self._send_json(200, {"models": models})
            return

        self._send_json(404, {"error": "not_found", "path": path})

    def do_POST(self) -> None:
        if not self._check_auth():
            return

        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length).decode("utf-8", errors="replace")

        try:
            payload = json.loads(raw_body) if raw_body else {}
        except Exception as exc:
            self._send_json(400, {"error": "bad_request", "detail": f"Malformed JSON: {exc}"})
            return

        if path == "/v1/cancel":
            key = str(payload.get("idempotencyKey") or "")
            with _in_flight_mutex:
                event = _in_flight_locks.get(key)
                if event:
                    event.set()
            logger.info("Cancellation requested for idempotencyKey: %s", key or "<none>")
            self._send_json(200, {"remote_cancellation": "acknowledged", "idempotencyKey": key})
            return

        if path == "/v1/complete":
            self._handle_complete(payload)
            return

        self._send_json(404, {"error": "not_found", "path": path})

    def _handle_complete(self, payload: Dict[str, Any]) -> None:
        model_id = str(payload.get("modelId") or DEFAULT_MODEL)
        system = str(payload.get("system") or "").strip()
        user = str(payload.get("user") or "").strip()
        params = payload.get("params") or {}
        idempotency_key = str(payload.get("idempotencyKey") or uuid.uuid4().hex[:16])

        cancel_event = threading.Event()
        with _in_flight_mutex:
            _in_flight_locks[idempotency_key] = cancel_event

        prompt_hash = _sha256(system + "\x1f" + user)
        logger.info(
            "Complete request: model=%s, prompt_hash=%s, idemp=%s",
            model_id, prompt_hash, idempotency_key
        )

        started = time.time()
        timeout = int(os.getenv("NOTION_TIMEOUT", "600"))

        ws = _workspace_pool.select(model_id)
        if not ws:
            with _in_flight_mutex:
                _in_flight_locks.pop(idempotency_key, None)
            self._send_json(503, {"error": "no_workspaces", "message": "No Notion workspaces available in account pool"})
            return

        def _do_call(target_ws: WorkspaceInfo) -> Tuple[Optional[str], Optional[Dict[str, Any]], Optional[Exception]]:
            try:
                reply, meta = notion_ai_auth.chat_completion(
                    prompt=user,
                    system_prompt=system if system else None,
                    space_id=target_ws.space_id,
                    user_id=target_ws.user_id,
                    token_file=target_ws.token_file,
                    timeout=timeout,
                )
                return reply, meta, None
            except Exception as e:
                return None, None, e

        full_reply, metadata, err = _do_call(ws)
        active_ws = ws

        # Failover logic: if rate limited or error occurs, try fallback workspaces in cascade
        if err is not None:
            err_str = str(err)
            is_rate_limit = "429" in err_str or "rate limit" in err_str.lower() or "credit" in err_str.lower()
            if is_rate_limit:
                ws.mark_rate_limited(cooldown_seconds=300)
                logger.warning("Workspace %d (%s) rate-limited: %s", ws.index, ws.space_id, err_str)
            else:
                ws.mark_rate_limited(cooldown_seconds=60)
                ws.failed_requests += 1
                logger.warning("Workspace %d (%s) failed (cooling down 60s): %s", ws.index, ws.space_id, err_str)

            for fallback_ws in _workspace_pool.get_fallbacks(ws):
                logger.info(
                    "Failing over request from Workspace %d to Workspace %d (%s)...",
                    active_ws.index, fallback_ws.index, fallback_ws.space_id
                )
                fb_reply, fb_meta, fb_err = _do_call(fallback_ws)
                if fb_err is None:
                    full_reply = fb_reply
                    metadata = fb_meta
                    err = None
                    active_ws = fallback_ws
                    break
                else:
                    fb_err_str = str(fb_err)
                    fb_is_rate = "429" in fb_err_str or "rate limit" in fb_err_str.lower() or "credit" in fb_err_str.lower()
                    if fb_is_rate:
                        fallback_ws.mark_rate_limited(cooldown_seconds=300)
                    else:
                        fallback_ws.mark_rate_limited(cooldown_seconds=60)
                        fallback_ws.failed_requests += 1
                    err = fb_err

        with _in_flight_mutex:
            _in_flight_locks.pop(idempotency_key, None)

        if err is not None:
            err_msg = str(err)
            active_ws.failed_requests += 1
            logger.error("Notion AI completion failed: %s", err_msg)
            status_code = 502
            if "unauthorized" in err_msg.lower() or "401" in err_msg:
                status_code = 401
            elif "rate limit" in err_msg.lower() or "429" in err_msg:
                status_code = 429
            self._send_json(status_code, {
                "error": "provider_error",
                "message": err_msg[:300],
            })
            return

        if cancel_event.is_set():
            logger.info("Request %s completed after cancellation; returning cancelled status", idempotency_key)
            self._send_json(499, {"error": "client_closed_request", "message": "Request cancelled"})
            return

        active_ws.completed_requests += 1
        text = full_reply or ""
        input_tokens = max(1, len(system + user) // 4)
        output_tokens = max(1, len(text) // 4)
        parsed_json = _extract_json(text)

        elapsed = time.time() - started
        logger.info(
            "Complete success via Workspace %d (%s) in %.2fs: output_chars=%d, in_tokens=%d, out_tokens=%d",
            active_ws.index, active_ws.space_id[:8], elapsed, len(text), input_tokens, output_tokens
        )

        resp_body = {
            "modelId": model_id,
            "provider": "notion",
            "providerRequestId": f"notion-{idempotency_key}",
            "workspaceIndex": active_ws.index,
            "workspaceId": active_ws.space_id,
            "workspaceAccount": active_ws.account_email,
            "text": text,
            "finishReason": "stop",
            "usage": {
                "input": input_tokens,
                "output": output_tokens,
                "cached": 0,
            },
            "latencyMs": int(elapsed * 1000),
        }
        if parsed_json is not None:
            resp_body["json"] = parsed_json

        self._send_json(200, resp_body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Notion AI Multi-Workspace Provider Bridge Service")
    parser.add_argument("--port", type=int, default=int(os.getenv("NOTION_PORT", "8092")), help="Port to listen on")
    parser.add_argument("--host", type=str, default=os.getenv("NOTION_HOST", "127.0.0.1"), help="Host to bind to")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), NotionBridgeHandler)
    logger.info("Notion AI Provider Bridge listening on http://%s:%d", args.host, args.port)
    logger.info("Health check: http://%s:%d/health", args.host, args.port)
    logger.info("Complete endpoint: http://%s:%d/v1/complete", args.host, args.port)
    logger.info("Detected workspaces: %d", len(_workspace_pool.workspaces))

    def _handle_sigterm(signum: int, frame: Any) -> None:
        logger.info("Shutting down Notion AI Provider Bridge...")
        threading.Thread(target=server.shutdown).start()

    signal.signal(signal.SIGINT, _handle_sigterm)
    signal.signal(signal.SIGTERM, _handle_sigterm)

    try:
        server.serve_forever()
    finally:
        server.server_close()
        logger.info("Server stopped.")


if __name__ == "__main__":
    main()
