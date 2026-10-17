// 简体中文文案。结构和 en.js 一一对应（test/i18n.test.mjs 会查）。写法和出处的要求见 en.js 开头。
// 大标题行尾不加标点：居中的两行字，句号逗号挂在行尾会把重心拉偏

export default {
  meta: {
    title: "SpeakMore — Mac 与 Windows 语音输入",
    description: "按下快捷键口述，整理后的文字即刻写入当前输入框。开源免费，使用自有 Gemini 密钥，月均成本约 1 美元。",
  },
  nav: {
    how: "使用",
    cost: "成本",
    privacy: "隐私",
    download: "下载",
    github: "SpeakMore 的 GitHub 仓库",
    home: "SpeakMore 首页",
  },
  hero: {
    title: "开口即成文",
    lead: "Mac 与 Windows 上的语音输入。\n一键唤起，适用于任意应用，自动整理成文。",
    shotAlt: "SpeakMore 主窗口首页：字数、节省时间、语速、每日热力图与花费",
    barAlt: "口述时的悬浮条：左侧取消，中间为随语音起伏的声波，右侧完成",
  },
  demo: {
    title: "口述随意\n成文规整",
    lead: "自动删除语气词、重复与改口前的内容，列举的事项整理为条目。",
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
  how: {
    title: "一键唤起\n适用于任意应用",
    lead: "文字直接写入光标所在位置，凡可粘贴之处均可使用。",
    steps: [
      { key: "右 ⌥", text: "按下" },
      { key: null, text: "口述" },
      { key: "右 ⌥", text: "再次按下" },
    ],
    speedValue: "约 2 秒",
    speedLabel: "口述结束至文字出现",
  },
  cost: {
    title: "月均成本\n约 1 美元",
    lead: "应用本身免费。使用自有密钥，按实际用量向 Google 付费。",
    once: { value: "$0.0003", label: "单次听写" },
    month: { value: "$0.67–1.05", label: "每月 430–870 次听写" },
    free: { value: "$0", label: "使用 Gemini 免费额度" },
  },
  look: {
    title: "三套主题\n深浅随系统切换",
    lead: "字数、节省时间、语速、连续使用天数与花费，一目了然。",
    themes: { ink: "墨", cinnabar: "朱砂", indigo: "靛青" },
    schemes: { light: "浅色", dark: "深色" },
    themeLabel: "主题",
    schemeLabel: "外观",
    alt: "SpeakMore 主窗口首页，{theme}主题，{scheme}",
  },
  privacy: {
    title: "隐私与开放",
    direct: { title: "直连模型", text: "录音由本机直接发送至模型，无需账号，记录仅存本机。" },
    models: { title: "Gemini 或 OpenAI", text: "使用自有密钥，可随时切换。" },
    open: { title: "开源", text: "采用 MIT 许可，源代码公开于 {github}。" },
    languages: { title: "中英双语", text: "界面跟随系统语言，也可在设置中切换。" },
  },
  download: {
    title: "立即开始",
    lead: "免费下载，适用于 macOS 12 及以上、Windows 10 及以上（64 位）。",
    buttons: { arm64: "下载 Apple 芯片版", x64: "下载 Intel 芯片版", windows: "下载 Windows 版" },
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
