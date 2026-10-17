// 内置的听写服务：就是 ../server 那个服务端，跑在主进程里，这样用的人不用另开一个终端。
// 页面和它之间仍然走 WebSocket，服务端照旧可以单独启动（调试、回放录音、评估提示词）。
// 走哪条识别链路、用哪些模型由"路线"定（../server/modes.mjs），设置里改了当场换。
// 本地转写链路要的本地模型由这里装卸：下载好了的装进转写进程，换模型或改走原生链路时卸掉。
// 下载不归这里：下不下由用户点（models/library.mjs），没下载的就停在 missing，说清楚去哪下。
import { LocalizedError, msg, problemOf } from "../i18n/index.mjs";
import { findModel } from "../models/catalog.mjs";
import { startTranscriber } from "../server/asr/start.mjs";
import { createModeRefiner, describeRoute, keyVendorOf, usesLocalModel } from "../server/modes.mjs";
import { startServer, WS_PATH } from "../server/server.mjs";

/**
 * 启动内置服务。端口由系统分配，所以不会和别的程序（或单独启动的服务端）抢端口。
 * 没有 key 时服务照样在听，只是每次整理都会失败并说明原因；这样页面连的地址始终不变，填了 key 立刻能用。
 *
 * @param {object} options
 * @param {{ info: Function, warn: Function, error: Function }} options.log
 * @param {object} options.route 一开始走哪条路线（设置里的 mode 和各项，storage/settings.mjs 的 routeOf）
 * @param {string} [options.modelsDir] 本地模型放在哪（storage/paths.mjs 的 modelsDir）
 * @param {{ isInstalled(id: string): boolean, status(id: string): { download: object | null } }} [options.models]
 *   本机的模型库（models/library.mjs）：哪些下载好了、正在下的下到哪。它变了要调 modelsChanged
 * @param {(record: object) => void} [options.onModelCall] 记账：每一次回了话的模型调用（听写和验证 key 都算），
 *   见 ../server/refine/meter.mjs
 * @param {() => void} [options.onLocalModel] 本地模型的状态变了（缺、装载中、装好了、出错）
 * @param {"auto" | "cpu"} [options.acceleration] 本地模型用不用显卡（设置里的 acceleration），换了调 setAcceleration
 * @param {typeof createModeRefiner} [options.createRefiner] 测试时换成假的
 * @param {typeof startTranscriber} [options.startLocal] 测试时换成假的
 */
export async function startService({
  log,
  route: initialRoute,
  modelsDir,
  models,
  onModelCall,
  onLocalModel = () => {},
  acceleration: initialAcceleration = "auto",
  createRefiner = createModeRefiner,
  startLocal = startTranscriber,
}) {
  /** 正在走的路线。换一条要带着它要的那家的 key 一起换（useKey 的 route），验证过了才换 */
  let route = initialRoute;
  /** 路线里另一家（第一跳交给的云端）缺 key 时是那一家（forgetKey 的 missing）：听写时点名它，不点名主的那家 */
  let missing = null;
  const noKey = () =>
    new LocalizedError(
      missing
        ? msg("key.noKeyServiceFor", { provider: missing.name, id: missing.id })
        : msg("key.noKeyService", { provider: keyVendorOf(route).name }),
    );
  /** 通过了验证、正在用的那一个；没有 key 时是 null */
  let refiner = null;

  // ---------- 本地模型 ----------

  /**
   * 本地转写链路要的那个模型现在怎样：
   *   off（没走本地转写）/ missing（还没下载）/ loading / ready / failed（problem 是原因）
   */
  let local = { state: "off" };
  let acceleration = initialAcceleration;
  /** 正在装载或已经装好的那一次：换模型时用 transcriber 卸掉模型；ready 是装载的那个 Promise，检查时等它 */
  let loading = null;

  function setLocal(next) {
    local = next;
    onLocalModel();
  }

  /** 让本地模型跟着路线走：要的是别的模型就换，不走本地转写就卸掉；没下载的停在 missing；上次没装上的再装一次 */
  function followRoute() {
    // 第一跳交给云端时没有本地模型要装
    const wanted = usesLocalModel(route) ? route.transcriber : null;
    if (wanted && !models.isInstalled(wanted)) {
      releaseLocal();
      if (local.state !== "missing" || local.model !== wanted) setLocal({ state: "missing", model: wanted });
      return;
    }
    if (loading?.model === wanted && local.state !== "failed") return;
    releaseLocal();
    if (wanted) loadLocal(wanted);
  }

  function loadLocal(model) {
    const job = { model, transcriber: null, ready: null };
    loading = job;
    setLocal({ state: "loading", model });
    job.ready = startLocal({ modelId: model, modelsDir, log, acceleration });
    job.ready.then(
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
    loading.transcriber?.dispose();
    loading = null;
    setLocal({ state: "off" });
  }

  /** 给外面看的本地模型状态：还没下载、但用户正在下它时带上进度 */
  function localView() {
    if (local.state !== "missing") return local;
    const download = models.status(local.model).download;
    return download ? { ...local, received: download.received, total: download.total } : local;
  }

  /** 交给本地转写链路的转写器：模型还没装好时说清是怎么回事，不让这次听写干等 */
  const transcriber = {
    transcribe(samples) {
      if (loading?.transcriber) return loading.transcriber.transcribe(samples);
      const view = localView();
      if (view.state === "missing" && view.total) {
        const percent = Math.floor((view.received / view.total) * 100);
        throw new LocalizedError(msg("local.modelDownloading", { percent }));
      }
      if (view.state === "missing") {
        throw new LocalizedError(msg("local.modelMissing", { model: findModel(view.model).name, id: view.model }));
      }
      if (view.state === "failed") throw new LocalizedError(view.problem);
      throw new LocalizedError(msg("local.modelLoading"));
    },
  };

  const build = (nextRoute, apiKey, keys) =>
    createRefiner({ route: nextRoute, apiKey, keys, transcriber, log, onCall: onModelCall });

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

    /** 本地模型现在怎样，见上面的 local（还没下载、正在下时带着 received、total） */
    get localModel() {
      return localView();
    },

    /** 模型库变了（下好了、删了、下载进度）：要的那个刚下好就装上 */
    modelsChanged() {
      followRoute();
      if (local.state === "missing") onLocalModel();
    },

    /** 换加速设置：装着（或正在装）本地模型的话按新的设置重装一遍 */
    setAcceleration(value) {
      if (value === acceleration) return;
      acceleration = value;
      if (!loading) return;
      releaseLocal();
      followRoute();
    },

    /**
     * 换一把 key。先拿它发一个最小的请求：key 无效、模型名写错、连不上都会在这里抛出来（都是分好类的
     * ModelError），这时原来能用的那把继续用。这个请求同时是预热，之后的第一次听写不会慢。
     * 本地转写链路验的是润色那一家：本地模型在后台另外准备，不等它。
     *
     * @param {string | null} apiKey 路线主的那家的 key（server/modes.mjs 的 keyVendorOf）；路线不用 key（数据隐私模式）时是 null
     * @param {{ allowUnverified?: boolean, route?: object, keys?: Record<string, string> }} [options]
     *   allowUnverified：只是暂时够不着那一家的话照样启用。启动时、换用存着的那把时用：它当初是验证过才存的，
     *   不该因为开机时没网、或者对方一时回了 503 就被判成不能用。
     *   route：连路线一起换（设置里改用别家、换链路）；不写就是正在走的那条。
     *   keys：路线要两家时另一家的 key（第一跳交给云端、润色交给别家），按厂商 id
     * @returns {Promise<{ verified: boolean }>} verified 为 false 表示先用着、还没验证
     */
    async useKey(apiKey, { allowUnverified = false, route: nextRoute = route, keys } = {}) {
      const candidate = await build(nextRoute, apiKey, keys);
      let verified = true;
      try {
        await candidate.warmUp();
      } catch (error) {
        if (!allowUnverified || error.kind !== "unavailable") throw error;
        verified = false;
      }
      refiner = candidate;
      missing = null;
      if (nextRoute !== route) log.info("route_switched", { from: describeRoute(route), to: describeRoute(nextRoute) });
      route = nextRoute;
      followRoute();
      return { verified };
    },

    /**
     * 只换 local 模式第一跳的本地模型（没装上的那个再选一次就是重试）。润色那一跳和 key 都不动，不用重新验证：
     * 转写器是按名字取的（上面的 transcriber），装好的 refiner 照用，新模型在后台装载。
     * 要下载好了的才换得过来，这条规矩在模式那一层（modes.mjs）
     * @param {string} model 本地模型的 id（models/catalog.mjs），调用方校验过
     */
    switchTranscriber(model) {
      if (route.mode !== "local" && route.mode !== "private") {
        throw new Error(`现在是 ${route.mode} 模式，只有 local 和 private 模式有本地模型可换`);
      }
      // 换到云端、或从云端换回本机，润色前面那一跳就不是同一个东西了，要重新装 refiner、验 key：走 useKey
      if (!usesLocalModel(route) || !usesLocalModel({ ...route, transcriber: model })) {
        throw new Error(`第一跳 ${route.transcriber} → ${model} 涉及云端模型，要走 useKey 换路线`);
      }
      // 同一个、也好好的：不用动。上次没装上的话照样往下走，再装一次
      if (model === route.transcriber && local.state !== "failed") return;
      log.info("transcriber_switched", { from: route.transcriber, to: model, retry: model === route.transcriber });
      route = { ...route, transcriber: model };
      followRoute();
    },

    /**
     * 检查一个本机模型：拿一段样本转写一次，看它能不能正常出字。正在用的那个（装好了或正在装）直接用它；
     * 别的临时装一个，转完就卸掉，不碰正在用的。要下载好了的，调用方先查过（modes.mjs）
     * @param {string} model 本地模型的 id
     * @param {Float32Array} samples 16 kHz 单声道（asr/probe.mjs 念的那句）
     * @returns {Promise<{ text: string, transcribeMs: number, loadMs: number | null, backend: string }>}
     *   loadMs：临时装的那个装了多久；用的是已经装着的是 null
     */
    async checkTranscriber(model, samples) {
      let transcriber;
      let loadMs = null;
      if (loading?.model === model) {
        transcriber = loading.transcriber ?? (await loading.ready);
      } else {
        const startedAt = performance.now();
        transcriber = await startLocal({ modelId: model, modelsDir, log });
        loadMs = Math.round(performance.now() - startedAt);
      }
      try {
        const startedAt = performance.now();
        const { text } = await transcriber.transcribe(samples);
        const transcribeMs = Math.round(performance.now() - startedAt);
        // 只记长度和耗时：转出来的是念的那句检查用的话，不是用户说的，但也没必要进日志
        log.info("transcriber_checked", {
          model,
          backend: transcriber.backend,
          load_ms: loadMs,
          transcribe_ms: transcribeMs,
          text_length: text.length,
        });
        return { text, transcribeMs, loadMs, backend: transcriber.backend };
      } finally {
        if (loadMs !== null) transcriber.dispose();
      }
    },

    /** 把正在用的那把再验一次，没通过就抛错。启动时没连上网的，之后靠它补上验证 */
    async verify() {
      if (!refiner) throw noKey();
      await refiner.warmUp();
    },

    /**
     * 拿一把 key 试某条路线，不换掉正在用的：给别家存 key 前验证、speakmore model check 都用它。
     * @param {{ route: object, apiKey: string, keys?: Record<string, string> }} options keys 同 useKey
     */
    async probe({ route: tried, apiKey, keys }) {
      await (await build(tried, apiKey, keys)).warmUp();
    },

    /**
     * 不再用手里那把 key（删了、没通过）。缺的是路线里另一家的时写上 missing（{ id, name }），听写时点名它
     * @param {{ missing?: { id: string, name: string } }} [options]
     */
    forgetKey({ missing: vendor = null } = {}) {
      refiner = null;
      missing = vendor;
    },

    async close() {
      releaseLocal();
      await server.close();
    },
  };
}
