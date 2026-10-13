import { loadConfig } from "./config.mjs";
import { log } from "./log.mjs";
import { createGeminiRefiner } from "./refiner.mjs";
import { startServer, WS_PATH } from "./server.mjs";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  // 配置写错是使用上的问题，给一句人话就够了，不需要调用栈
  console.error(error.message);
  process.exit(2);
}

const refiner = createGeminiRefiner(config.gemini);
const server = await startServer({ host: config.host, port: config.port, refiner, log });
log.info("listening", {
  url: `ws://${config.host}:${server.port}${WS_PATH}`,
  model: config.gemini.model,
  thinking_level: config.gemini.thinkingLevel,
});

// 不等它：预热失败不该拦着服务启动，但要让人看得见
const warmUpStartedAt = performance.now();
refiner.warmUp().then(
  () => log.info("warmed_up", { ms: Math.round(performance.now() - warmUpStartedAt) }),
  (error) => log.error("warm_up_failed", { model: config.gemini.model, error: String(error?.message ?? error) }),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info("shutting_down", { signal });
    await server.close();
    process.exit(0);
  });
}
