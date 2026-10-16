// 内置的听写服务：就是 ../server 那个服务端，跑在主进程里，这样用的人不用另开一个终端。
// 页面和它之间仍然走 WebSocket，服务端照旧可以单独启动（调试、回放录音、评估提示词）。
// 走哪条识别链路、用哪些模型由"路线"定（../server/modes.mjs），设置里改了当场换。
// 本地转写链路要的本地模型由这里管：没下载过就在后台下载，下好了装进转写进程，换模型或改走原生链路时卸掉。
import { LocalizedError, msg, problemOf } from "../i18n/index.mjs";
import { startTranscriber } from "../server/asr/start.mjs";
import { createModeRefiner, describeRoute, keyVendorOf } from "../server/modes.mjs";
import { startServer, WS_PATH } from "../server/server.mjs";

/** 下载进度最多这么久报一次，不刷屏 */
const PROGRESS_EVERY_MS = 500;

/**
 * 启动内置服务。端口由系统分配，所以不会和别的程序（或单独启动的服务端）抢端口。
 * 没有 key 时服务照样在听，只是每次整理都会失败并说明原因；这样页面连的地址始终不变，填了 key 立刻能用。
 *
 * @param {object} options
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {object} options.route 一开始走哪条路线（设置里的 mode 和各项，storage/settings.mjs 的 routeOf）
 * @param {string} [options.modelsDir] 本地模型放在哪（storage/paths.mjs 的 modelsDir）
 * @param {(record: object) => void} [options.onModelCall] 记账：每一次回了话的模型调用（听写和验证 key 都算），
 *   见 ../server/refine/meter.mjs
 * @param {() => void} [options.onLocalModel] 本地模型的状态变了（开始下载、进度、装好了、出错）
 * @param {typeof createModeRefiner} [options.createRefiner] 测试时换成假的
 * @param {typeof startTranscriber} [options.startLocal] 测试时换成假的
 */
export async function startService({
  log,
  route: initialRoute,
  modelsDir,
  onModelCall,
  onLocalModel = () => {},
  createRefiner = createModeRefiner,
  startLocal = startTranscriber,
}) {
  /** 正在走的路线。换一条要带着它要的那家的 key 一起换（useKey 的 route），验证过了才换 */
  let route = initialRoute;
  const noKey = () => new LocalizedError(msg("key.noKeyService", { provider: keyVendorOf(route).name }));
  /** 通过了验证、正在用的那一个；没有 key 时是 null */
  let refiner = null;

  // ---------- 本地模型 ----------

  /**
   * 本地转写链路要的那个模型现在怎样：
   *   off（没走本地转写）/ downloading（received、total 是字节）/ loading / ready / failed（problem 是原因）
   */
  let local = { state: "off" };
  /** 正在下载或已经装好的那一次：换模型时用 abort 停掉下载，用 transcriber 卸掉模型 */
  let loading = null;

  function setLocal(next) {
    local = next;
    onLocalModel();
  }

  /** 让本地模型跟着路线走：要的是别的模型就换，不走本地转写就卸掉；上次没装上的再装一次 */
  function followRoute() {
    const wanted = route.mode === "local" ? route.transcriber : null;
    if (loading?.model === wanted && local.state !== "failed") return;
    releaseLocal();
    if (wanted) loadLocal(wanted);
  }

  function loadLocal(model) {
    const job = { model, abort: new AbortController(), transcriber: null };
    loading = job;
    let reportedAt = Number.NEGATIVE_INFINITY;
    setLocal({ state: "loading", model });
    startLocal({
      modelId: model,
      modelsDir,
      log,
      signal: job.abort.signal,
      onProgress: ({ received, total }) => {
        const now = performance.now();
        if (now - reportedAt < PROGRESS_EVERY_MS && received < total) return;
        reportedAt = now;
        setLocal({ state: received < total ? "downloading" : "loading", model, received, total });
      },
    }).then(
      (transcriber) => {
        if (loading !== job) {
          // 等它装好的这段时间里用户已经换了模型
          transcriber.dispose();
          return;
        }
        job.transcriber = transcriber;
        setLocal({ state: "ready", model, backend: transcriber.backend });
      },
      (error) => {
        if (loading !== job) return;
        log.error("local_model_failed", { model, error: String(error?.stack ?? error) });
        setLocal({ state: "failed", model, problem: msg("local.modelFailed", { reason: problemOf(error) }) });
      },
    );
  }

  function releaseLocal() {
    if (!loading) return;
    loading.abort.abort();
    loading.transcriber?.dispose();
    loading = null;
    setLocal({ state: "off" });
  }

  /** 交给本地转写链路的转写器：模型还没装好时说清在干什么，不让这次听写干等 */
  const transcriber = {
    transcribe(samples) {
      if (loading?.transcriber) return loading.transcriber.transcribe(samples);
      if (local.state === "downloading") {
        const percent = Math.floor((local.received / local.total) * 100);
        throw new LocalizedError(msg("local.modelDownloading", { percent }));
      }
      if (local.state === "failed") throw new LocalizedError(local.problem);
      throw new LocalizedError(msg("local.modelLoading"));
    },
  };

  const build = (nextRoute, apiKey) =>
    createRefiner({ route: nextRoute, apiKey, transcriber, log, onCall: onModelCall });

  followRoute();

  const server = await startServer({
    port: 0,
    log,
    refiner: {
      async refine(audio, options) {
        if (!refiner) throw noKey();
        return refiner.refine(audio, options);
      },
      /** 开口时先做的准备（Gemini 建提示词缓存）。还没有 key 时没什么可准备的 */
      async prepare() {
        await refiner?.prepare?.();
      },
    },
  });

  return {
    url: `ws://127.0.0.1:${server.port}${WS_PATH}`,

    get ready() {
      return refiner !== null;
    },

    /** 正在走的路线 */
    get route() {
      return route;
    },

    /** 本地模型现在怎样，见上面的 local */
    get localModel() {
      return local;
    },

    /**
     * 换一把 key。先拿它发一个最小的请求：key 无效、模型名写错、连不上都会在这里抛出来（都是分好类的
     * ModelError），这时原来能用的那把继续用。这个请求同时是预热，之后的第一次听写不会慢。
     * 本地转写链路验的是润色那一家：本地模型在后台另外准备，不等它。
     *
     * @param {string} apiKey
     * @param {{ allowUnverified?: boolean, route?: object }} [options]
     *   allowUnverified：只是暂时够不着那一家的话照样启用。启动时、换用存着的那把时用：它当初是验证过才存的，
     *   不该因为开机时没网、或者对方一时回了 503 就被判成不能用。
     *   route：连路线一起换（设置里改用别家、换链路）；不写就是正在走的那条
     * @returns {Promise<{ verified: boolean }>} verified 为 false 表示先用着、还没验证
     */
    async useKey(apiKey, { allowUnverified = false, route: nextRoute = route } = {}) {
      const candidate = await build(nextRoute, apiKey);
      let verified = true;
      try {
        await candidate.warmUp();
      } catch (error) {
        if (!allowUnverified || error.kind !== "unavailable") throw error;
        verified = false;
      }
      refiner = candidate;
      if (nextRoute !== route) log.info("route_switched", { from: describeRoute(route), to: describeRoute(nextRoute) });
      route = nextRoute;
      followRoute();
      return { verified };
    },

    /**
     * 只换 local 模式第一跳的本地模型（没装上的那个再选一次就是重试）。润色那一跳和 key 都不动，不用重新验证：
     * 转写器是按名字取的（上面的 transcriber），装好的 refiner 照用，新模型在后台下载、装载
     * @param {string} model 本地模型的 id（asr/catalog.mjs），调用方校验过
     */
    switchTranscriber(model) {
      if (route.mode !== "local") throw new Error(`现在不是 local 模式（${route.mode}），没有本地模型可换`);
      // 同一个、也好好的：不用动。上次没装上的话照样往下走，再装一次
      if (model === route.transcriber && local.state !== "failed") return;
      log.info("transcriber_switched", { from: route.transcriber, to: model, retry: model === route.transcriber });
      route = { ...route, transcriber: model };
      followRoute();
    },

    /** 把正在用的那把再验一次，没通过就抛错。启动时没连上网的，之后靠它补上验证 */
    async verify() {
      if (!refiner) throw noKey();
      await refiner.warmUp();
    },

    /**
     * 拿一把 key 试某条路线，不换掉正在用的：给别家存 key 前验证、speakmore model check 都用它。
     * @param {{ route: object, apiKey: string }} options
     */
    async probe({ route: tried, apiKey }) {
      await (await build(tried, apiKey)).warmUp();
    },

    forgetKey() {
      refiner = null;
    },

    async close() {
      releaseLocal();
      await server.close();
    },
  };
}
