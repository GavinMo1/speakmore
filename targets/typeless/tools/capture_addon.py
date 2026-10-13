"""mitmproxy 插件：抓 Typeless 客户端与 api.typeless.com 之间的全部 HTTP 与 WebSocket 流量。

配合客户端自带的 `__DEV_API_HOST` 开关使用（见 capture.sh）：客户端以明文连本机，
本插件所在的 mitmdump 以 reverse 模式转发到真实服务端，因此不需要装证书。

可选的"上下文解密"（set decrypt_context=true）：
  客户端把 audio_context 用服务端下发的 RSA 公钥加密成信封，抓到的只有密文。
  打开后本插件把 /user/get_user_info 回包里的公钥换成本机临时生成的公钥，
  于是能解开信封记下明文，再用真实公钥重新加密后转发，服务端收到的内容不变。
  私钥只存在于本次进程内存，不落盘。

输出（都在 capture_dir 下，属于抓包原件，不进仓库）：
  flows.mitm            mitmdump -w 写出的原生抓包，供 REA inspect_web_network_capture 使用
  http.jsonl            每个 HTTP 请求/响应一行
  ws.jsonl              每条 WebSocket 消息一行（二进制只记长度和头部字节）
  context/<n>.json      解密出的 audio_context 明文
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from mitmproxy import ctx, http

log = logging.getLogger("typeless-capture")

# 客户端信封固定用 12 字节全零 IV（每次的 AES 密钥都是新随机的，所以不重复）
ZERO_IV = bytes(12)
OAEP = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
# 这些头带登录凭据或可重放的签名，记录时只留长度
SENSITIVE_HEADERS = {"authorization", "x-authorization", "cookie", "set-cookie"}
MAX_TEXT_BODY = 256 * 1024


def is_envelope(value) -> bool:
    return (
        isinstance(value, dict)
        and value.get("_encrypted") is True
        and isinstance(value.get("_key"), str)
        and isinstance(value.get("_data"), str)
    )


class TypelessCapture:
    def __init__(self) -> None:
        self.out: Path | None = None
        self.private_key: rsa.RSAPrivateKey | None = None
        self.our_public_pem: str = ""
        self.real_public_pem: str | None = None
        self.context_seq = 0

    def load(self, loader) -> None:
        loader.add_option("capture_dir", str, "", "抓包输出目录（必填）")
        loader.add_option("decrypt_context", bool, False, "替换 RSA 公钥以解出 audio_context 明文")

    def configure(self, updated) -> None:
        if not ctx.options.capture_dir:
            raise ValueError("必须指定 --set capture_dir=<目录>")
        self.out = Path(ctx.options.capture_dir)
        (self.out / "context").mkdir(parents=True, exist_ok=True)
        if ctx.options.decrypt_context and self.private_key is None:
            self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            self.our_public_pem = (
                self.private_key.public_key()
                .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
                .decode()
            )
            log.info("已生成临时 RSA 密钥对，用于解出 audio_context")

    # ---------- 记录 ----------

    def _append(self, name: str, record: dict) -> None:
        record["ts"] = time.time()
        with open(self.out / name, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    @staticmethod
    def _headers(headers) -> dict:
        result = {}
        for key, value in headers.items(multi=True):
            if key.lower() in SENSITIVE_HEADERS:
                value = f"<已隐去，{len(value)} 字符>"
            result.setdefault(key, value)
        return result

    @staticmethod
    def _body(message) -> dict:
        raw = message.raw_content or b""
        content_type = message.headers.get("content-type", "")
        info: dict = {"bytes": len(raw), "content_type": content_type}
        if not raw:
            return info
        if "multipart/form-data" in content_type:
            fields = {}
            for key, value in message.multipart_form.items(multi=True):
                name = key.decode(errors="replace")
                try:
                    text = value.decode("utf-8")
                    fields[name] = text if len(text) <= MAX_TEXT_BODY else f"<文本 {len(text)} 字符>"
                except UnicodeDecodeError:
                    fields[name] = f"<二进制 {len(value)} 字节，头部 {value[:8].hex()}>"
            info["multipart"] = fields
        elif "json" in content_type or "text" in content_type:
            text = message.get_text(strict=False) or ""
            info["text"] = text if len(text) <= MAX_TEXT_BODY else text[:MAX_TEXT_BODY] + "…<截断>"
        else:
            info["head_hex"] = raw[:16].hex()
        return info

    # ---------- 信封加解密 ----------

    def _decrypt(self, envelope: dict):
        aes_key = self.private_key.decrypt(base64.b64decode(envelope["_key"]), OAEP)
        plain = AESGCM(aes_key).decrypt(ZERO_IV, base64.b64decode(envelope["_data"]), None).decode("utf-8")
        return json.loads(plain) if envelope.get("_type") == "json" else plain

    def _encrypt(self, value, envelope_type: str) -> dict:
        public_key = serialization.load_pem_public_key(self.real_public_pem.encode())
        aes_key = os.urandom(32)
        plain = json.dumps(value, ensure_ascii=False, separators=(",", ":")) if envelope_type == "json" else value
        return {
            "_encrypted": True,
            "_v": 1,
            "_type": envelope_type,
            "_key": base64.b64encode(public_key.encrypt(aes_key, OAEP)).decode(),
            "_data": base64.b64encode(AESGCM(aes_key).encrypt(ZERO_IV, plain.encode("utf-8"), None)).decode(),
        }

    def _reveal(self, envelope: dict, where: str):
        """解出明文并落盘，返回用真实公钥重新加密的信封；任何一步失败都原样放行并记日志。"""
        if not (self.private_key and is_envelope(envelope)):
            return envelope
        try:
            plain = self._decrypt(envelope)
        except Exception as exc:  # 用的是服务端真实公钥加密的（例如换钥之前的缓存），解不开属正常
            log.warning("信封解不开（%s）：%s，原样转发", where, exc)
            return envelope
        self.context_seq += 1
        path = self.out / "context" / f"{self.context_seq:03d}.json"
        path.write_text(json.dumps({"where": where, "plain": plain}, ensure_ascii=False, indent=1), encoding="utf-8")
        log.info("已解出 audio_context → %s", path.name)
        if not self.real_public_pem:
            # 没拿到真实公钥就无法还原成服务端能解的密文；宁可让这一次请求失败，也不静默发出错误内容
            raise RuntimeError("尚未获得服务端真实公钥，无法重新加密")
        return self._encrypt(plain, envelope.get("_type", "json"))

    # ---------- HTTP ----------

    def request(self, flow: http.HTTPFlow) -> None:
        if not self.private_key:
            return
        request = flow.request
        content_type = request.headers.get("content-type", "")
        try:
            if "multipart/form-data" in content_type and b"audio_context" in (request.raw_content or b""):
                form = request.multipart_form
                raw = form.get(b"audio_context")
                if raw:
                    envelope = json.loads(raw)
                    if is_envelope(envelope):
                        form[b"audio_context"] = json.dumps(self._reveal(envelope, request.path)).encode()
                        request.multipart_form = form
            elif "json" in content_type and b"_encrypted" in (request.raw_content or b""):
                body = json.loads(request.get_text())
                changed = False
                for key, value in list(body.items()) if isinstance(body, dict) else []:
                    if is_envelope(value):
                        body[key] = self._reveal(value, f"{request.path}#{key}")
                        changed = True
                if changed:
                    request.set_text(json.dumps(body, ensure_ascii=False))
        except Exception:
            log.exception("改写请求失败：%s", request.path)
            raise

    def response(self, flow: http.HTTPFlow) -> None:
        request, response = flow.request, flow.response
        record = {
            "method": request.method,
            "path": request.path,
            "status": response.status_code,
            "request_headers": self._headers(request.headers),
            "request_body": self._body(request),
            "response_headers": self._headers(response.headers),
            "response_body": self._body(response),
            "duration_ms": round((response.timestamp_end - request.timestamp_start) * 1000, 1),
        }
        if self.private_key and request.path.split("?")[0].endswith("/user/get_user_info") and response.status_code == 200:
            try:
                body = json.loads(response.get_text())
                real = (body.get("data") or {}).get("rsa_public_key")
                if real:
                    self.real_public_pem = real
                    body["data"]["rsa_public_key"] = self.our_public_pem
                    response.set_text(json.dumps(body, ensure_ascii=False))
                    record["note"] = "rsa_public_key 已替换为本机临时公钥"
            except Exception:
                log.exception("替换公钥失败，回包原样放行")
        self._append("http.jsonl", record)

    # ---------- WebSocket ----------

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        message = flow.websocket.messages[-1]
        record: dict = {"path": flow.request.path.split("?")[0], "from": "client" if message.from_client else "server"}
        if message.is_text:
            text = message.text
            if self.private_key and message.from_client and '"_encrypted"' in text:
                try:
                    body = json.loads(text)
                    if is_envelope(body.get("audio_context")):
                        body["audio_context"] = self._reveal(body["audio_context"], f"ws:{body.get('type')}")
                        text = json.dumps(body, ensure_ascii=False)
                        message.content = text.encode("utf-8")
                except Exception:
                    log.exception("改写 WebSocket 消息失败")
                    raise
            record["text"] = text if len(text) <= MAX_TEXT_BODY else text[:MAX_TEXT_BODY] + "…<截断>"
        else:
            record["binary_bytes"] = len(message.content)
            record["head_hex"] = message.content[:8].hex()
        self._append("ws.jsonl", record)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        ws = flow.websocket
        self._append(
            "ws.jsonl",
            {
                "path": flow.request.path.split("?")[0],
                "event": "closed",
                "close_code": ws.close_code,
                "close_reason": ws.close_reason,
                "messages": len(ws.messages),
            },
        )


addons = [TypelessCapture()]
