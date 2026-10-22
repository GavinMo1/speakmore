import { LocalizedError, msg } from "../../i18n/index.mjs";

const REQUEST_MS = 10_000;

/** OpenAI 兼容协议没有卸载接口；只在用户明确选择后，调用本机 Ollama 的原生接口。 */
export function withOllamaIdleRelease({
  client,
  baseUrl,
  model,
  apiKey,
  log,
  idleMinutes = "5",
  fetch = globalThis.fetch,
}) {
  const url = new URL(baseUrl);
  const supported = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.pathname === "/v1";
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  let verified;
  let active = 0;
  let timer = null;
  let releasing = null;
  let disposed = false;

  async function verify() {
    if (!supported) throw new LocalizedError(msg("chat.memoryUnsupported"));
    const response = await fetch(`${url.origin}/api/version`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_MS),
      redirect: "error",
    });
    let body;
    try {
      body = response.ok ? await response.json() : null;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (typeof body?.version !== "string" || !/^\d+\.\d+\.\d+/.test(body.version))
      throw new LocalizedError(msg("chat.memoryUnsupported"));
  }

  async function keepAlive(value) {
    const response = await fetch(`${url.origin}/api/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, keep_alive: value, stream: false }),
      signal: AbortSignal.timeout(REQUEST_MS),
      redirect: "error",
    });
    const body = response.ok ? await response.json() : null;
    if (!body?.done || body.error) throw new Error(`HTTP ${response.status}`);
  }

  function scheduleRelease() {
    if (active || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      releasing = (async () => {
        try {
          await keepAlive(0);
          log.info("ollama_idle_released", { model });
        } catch (error) {
          // 不让资源回收失败覆盖用户已经得到的文字，也不把服务的响应正文（可能有密钥）写进日志。
          log.error("ollama_idle_release_failed", { model, error: error.name });
        } finally {
          releasing = null;
        }
      })();
    }, Number(idleMinutes) * 60_000);
    timer.unref?.();
  }

  async function run(method, options) {
    clearTimeout(timer);
    timer = null;
    active++;
    let ready = false;
    try {
      verified ??= verify().catch((error) => {
        verified = undefined;
        throw error;
      });
      await verified;
      await releasing;
      ready = true;
      const result = await client[method](options);
      if (!disposed) {
        try {
          // Chat Completions 不接受 keep_alive；单独刷新这个模型，避免被服务默认五分钟提前卸载。
          await keepAlive(`${idleMinutes}m`);
        } catch (error) {
          log.error("ollama_idle_retention_failed", { model, error: error.name });
        }
      }
      return result;
    } finally {
      active--;
      if (ready) scheduleRelease();
    }
  }

  return {
    ...client,
    ping: (options) => run("ping", options),
    complete: (options) => run("complete", options),
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = null;
      client.dispose?.();
    },
  };
}
