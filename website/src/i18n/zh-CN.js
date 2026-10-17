// 简体中文文案。结构和 en.js 一一对应（test/i18n.test.mjs 会查）。写法和出处的要求见 en.js 开头。
// 大标题行尾不加标点：两行字的重心靠位置和深浅分，标点挂在行尾会把重心拉偏

export default {
  meta: {
    title: "SpeakMore — Mac 与 Windows 语音输入",
    description: "按下快捷键口述，整理后的文字写入当前输入框。开源免费；模型、识别方式与费用自选。",
  },
  nav: {
    ways: "识别方式",
    speed: "性能",
    models: "模型",
    privacy: "隐私",
    cost: "费用",
    download: "下载",
    github: "SpeakMore 的 GitHub 仓库",
    home: "SpeakMore 首页",
  },
  hero: {
    title: "开口即成文",
    lead: "Mac 与 Windows 上的语音输入。\n模型、方式、费用，由你决定。",
    shotAlt: "SpeakMore 主窗口首页：字数、省时、语速、口述时长与每日热力图，右上角选择识别方式",
    barAlt: "口述时的悬浮条：左侧取消，中间为随语音起伏的声波，右侧完成",
  },
  demo: {
    title: "口述随意\n成文规整",
    lead: "按一下快捷键开始，再按一下结束。语气词、重复与改口自动删除，列举整理为条目。",
    said: "口述原话",
    written: "整理结果",
    examples: [
      {
        label: "去除口癖",
        said: "~~嗯，那个，~~我们后天开会吧，~~呃，~~记得把~~，把上周的数据带上。哦不对，是~~上个月的。",
        written: "我们后天开会吧，记得把上个月的数据带上",
      },
      {
        label: "整理条目",
        said: "明天要做三件事，~~第一个是~~改一下 README，~~第二个是~~发 0.6.2，~~然后第三个，嗯，就是~~把官网更新一下。",
        written: "明天要做三件事：\n\n1. 改一下 README\n2. 发 0.6.2\n3. 把官网更新一下",
      },
    ],
  },
  models: {
    title: "主流模型\n任意接入",
    lead: "原生识别、转写、润色三类模型分开挑选；兼容 OpenAI 接口的服务同样可以接入。",
    loopLabel: "可接入的模型",
    vendors: {
      gemini: "Google Gemini",
      openai: "OpenAI",
      qwen: "通义千问",
      bailian: "阿里云百炼",
      deepseek: "DeepSeek",
      kimi: "Kimi",
      zhipu: "智谱",
      minimax: "MiniMax",
      funaudiollm: "SenseVoice",
      custom: "自定义服务",
    },
    points: [
      { title: "密钥自备", text: "加密存于本机，随时更换。" },
      { title: "实测标注", text: "评测过的模型标出得分。" },
      { title: "即换即用", text: "更换模型无需重启。" },
    ],
    shotAlt: "模型页的润色分类：DeepSeek、通义千问、Kimi、智谱、MiniMax 等各家模型，标有价格与评测得分",
  },
  ways: {
    title: "三种识别方式\n按需切换",
    lead: "首页一键切换，各方式的模型配置分别保存。",
    lanes: { cloud: "云端", device: "本机", offline: "不联网" },
    items: [
      {
        id: "native",
        name: "原生识别",
        text: "音频直达模型，单次成稿。",
        facts: ["上传音频", "需要密钥"],
        steps: ["录音", "大模型", "成稿"],
        carry: "音频",
      },
      {
        id: "local",
        name: "转写 + 润色",
        text: "本机转写，任意模型润色。",
        facts: ["只上传文字", "需要密钥"],
        steps: ["录音", "本机转写", "润色", "成稿"],
        carry: "文字",
      },
      {
        id: "private",
        name: "数据隐私",
        text: "全程本机，不联网。",
        facts: ["不上传任何数据", "无需密钥"],
        steps: ["录音", "本机转写", "成稿"],
      },
    ],
  },
  speed: {
    title: "速度快\n占用少",
    lead: "处理器与显卡均可运行，有显卡时自动加速。",
    headline: { label: "主流硬件", value: "2", prefix: "<", unit: "秒", text: "松开快捷键到文字出现" },
    stats: [
      { value: "0.23", unit: "秒", label: "本机转写", note: "Apple 芯片" },
      { value: "850", unit: "MB", label: "本机模型", note: "下载一次即可" },
    ],
    hardware: {
      label: "支持的硬件",
      groups: [
        {
          id: "cpu",
          name: "处理器",
          note: "直接运行",
          items: [
            { icon: "apple", brand: "Apple", series: "M 系列" },
            { icon: "intel", brand: "Intel", series: "Core" },
            { icon: "amd", brand: "AMD", series: "Ryzen" },
          ],
        },
        {
          id: "gpu",
          name: "显卡",
          note: "自动加速",
          items: [
            { icon: "nvidia", brand: "NVIDIA", series: "GeForce" },
            { icon: "amd", brand: "AMD", series: "Radeon" },
            { icon: "intel", brand: "Intel", series: "Arc · Iris\u00a0Xe" },
          ],
        },
      ],
    },
    long: { title: "长录音同样稳定", text: "近三分钟的口述，完整成文，不截断。", start: "0:00", end: "2:52" },
  },
  privacy: {
    title: "数据\n只留本机",
    lead: "选择数据隐私方式，录音与文字全程不出本机。",
    items: [
      { icon: "offline", title: "不上传", text: "转写在本机完成" },
      { icon: "account", title: "无需账号", text: "打开即可使用" },
      { icon: "key", title: "密钥加密", text: "经系统加密存于本机" },
      { icon: "history", title: "记录本机", text: "历史只存在这台电脑" },
    ],
    mirror: {
      title: "国内源下载\n快十余倍",
      text: "本机模型从国内源下载，850 MB 约一分半钟。",
      alt: "下载速度对比：国内源约 9.7 MB/s，Hugging Face 约 0.7 MB/s",
    },
  },
  cost: {
    title: "每月几块钱\n或者一分不花",
    lead: "软件免费。只为所用模型付费，或完全在本机运行。",
    per: "/ 月",
    paid: {
      badge: "推荐",
      name: "转写 + 润色",
      note: "每天 100 次识别",
      points: ["出字最快", "成稿最稳", "按量付费，无订阅"],
    },
    free: {
      name: "数据隐私",
      note: "下载模型即可使用",
      points: ["完全免费", "数据不出本机", "本机运行 AI 模型"],
    },
  },
  setup: {
    title: "三分钟\n完成设置",
    lead: "选方式、备模型、开权限、试一句。每一步均可跳过。",
    steps: ["选择识别方式", "准备模型与密钥", "开启权限", "测试麦克风", "测试快捷键", "试说一句", "开始使用"],
    alt: "首次引导第 {n} 步：{step}",
    previous: "上一步",
    next: "下一步",
  },
  features: {
    label: "更多特性",
    items: [
      { icon: "translate", title: "中英双语", text: "界面跟随系统语言" },
      { icon: "palette", title: "三套主题", text: "深浅色自动切换" },
      { icon: "history", title: "历史与花费", text: "本机记录，随时查看" },
      { icon: "terminal", title: "命令行", text: "一行命令安装" },
      { icon: "github", title: "开源", text: "MIT 许可" },
    ],
  },
  download: {
    title: "立即开始",
    lead: "免费下载。macOS 12 及以上；Windows 10 及以上（64 位）。",
    buttons: { arm64: "下载 Apple 芯片版", windows: "下载 Windows 版" },
    intel: "Intel 芯片 Mac 版",
    terminal: { mac: "macOS · 终端", windows: "Windows · PowerShell" },
    copy: "复制",
    copied: "已复制",
  },
  footer: {
    license: "MIT 许可",
    source: "源代码",
    switchTo: "English",
    switchLabel: "Switch to English",
  },
};
