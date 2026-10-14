import { log } from "../log.mjs";
import { loadConfig } from "./config.mjs";
import { formatModelChoice } from "./providers/index.mjs";
import { createModelRefiner } from "./refine/refiner.mjs";
import { startServer, WS_PATH } from "./server.mjs";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  // 配置写错是使用上的问题，给一句人话就够了，不需要调用栈
  console.error(error.message);
  process.exit(2);
}

const model = formatModelChoice(config.model);
const refiner = await createModelRefiner({
  choice: config.model,
  apiKey: config.apiKey,
  thinkingLevel: config.thinkingLevel,
  log,
});
let server;
try {
  server = await startServer({ host: config.host, port: config.port, refiner, log });
} catch (error) {
  if (error.code !== "EADDRINUSE") throw error;
  // 最常见的原因是已经开着一个了，给一句人话，不甩调用栈
  console.error(`端口 ${config.port} 已经被占用：服务端可能已经在运行。要另开一个就用 PORT 换端口。`);
  process.exit(1);
}
log.info("listening", {
  url: `ws://${config.host}:${server.port}${WS_PATH}`,
  model,
  thinking_level: config.thinkingLevel,
});

// 不等它：预热失败不该拦着服务启动，但要让人看得见
const warmUpStartedAt = performance.now();
refiner.warmUp().then(
  () => log.info("warmed_up", { ms: Math.round(performance.now() - warmUpStartedAt) }),
  (error) => log.error("warm_up_failed", { model, error: error.message, detail: error.detail }),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info("shutting_down", { signal });
    await server.close();
    process.exit(0);
  });
}
