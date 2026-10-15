// 英文文案。和 zh-CN.js 的结构一一对应（test/i18n.test.mjs 会查），改一份就改两份。
// 写法：书面语，简洁平实，不用口语和俏皮话；数字都要有出处（README 的成本一节、docs/development.md 的实测）。
// 标题里的 \n 是换行的位置；口述里 ~~ 括起来的是会被删掉的部分。

export default {
  meta: {
    title: "SpeakMore — Voice dictation for Mac",
    description:
      "Press a key, speak, and polished text appears where you type. Free and open source. About $1 a month with your own Gemini key.",
  },
  nav: {
    how: "How",
    cost: "Cost",
    privacy: "Privacy",
    download: "Download",
    github: "SpeakMore on GitHub",
    switchTo: "中文",
    switchLabel: "切换到简体中文",
    home: "SpeakMore home",
  },
  hero: {
    title: "Speak more.\nType less.",
    lead: "Voice dictation for Mac.\nOne key, any app, polished text.",
    shotAlt: "SpeakMore's home window: words, time saved, pace, a daily heatmap and spend",
    barAlt: "The floating bar during dictation: cancel, a live waveform, done",
  },
  demo: {
    title: "Speak naturally.\nRead polished text.",
    lead: "Filler words, repetitions and self-corrections are removed. Enumerations become lists.",
    said: "Spoken",
    written: "Written",
    examples: [
      {
        label: "Filler words",
        said: "~~Um, ~~so, let's meet the day after tomorrow, ~~uh, ~~and bring~~, bring last week's numbers. Actually no,~~ last month's numbers.",
        written: "So, let's meet the day after tomorrow, and bring last month's numbers.",
      },
      {
        label: "Lists",
        said: "~~Okay so ~~tomorrow I need to do three things, ~~first ~~fix the README, ~~second ~~ship version 0.6.2, ~~and third, um, ~~update the website.",
        written:
          "Tomorrow I need to do three things:\n\n1. Fix the README\n2. Ship version 0.6.2\n3. Update the website",
      },
    ],
  },
  how: {
    title: "One key.\nEvery app.",
    lead: "Text appears at your cursor, in any app that accepts paste.",
    steps: [
      { key: "Right ⌥", text: "Press" },
      { key: null, text: "Speak" },
      { key: "Right ⌥", text: "Press again" },
    ],
    speedValue: "≈2 s",
    speedLabel: "from end of speech to text",
  },
  cost: {
    title: "About $1\na month.",
    lead: "The app is free. Use your own key and pay Google only for what you use.",
    items: [
      { label: "The app", value: "Free" },
      { label: "Per dictation", value: "$0.0003" },
      { label: "430–870 dictations a month", value: "$0.67–1.05", highlight: true },
      { label: "On Gemini's free tier", value: "$0" },
    ],
  },
  look: {
    title: "Three themes.\nLight and dark.",
    lead: "Words, time saved, pace, streaks and spend, at a glance.",
    themes: { ink: "Ink", cinnabar: "Cinnabar", indigo: "Indigo" },
    schemes: { light: "Light", dark: "Dark" },
    themeLabel: "Theme",
    schemeLabel: "Appearance",
    alt: "SpeakMore's home window, {theme} theme, {scheme}",
  },
  privacy: {
    title: "Private and open.",
    direct: {
      title: "Direct to the model",
      text: "Audio goes straight from your Mac to the model. No account; history stays local.",
    },
    models: { title: "Gemini or OpenAI", text: "Use your own key and switch at any time." },
    open: { title: "Open source", text: "MIT licensed. The source code is on {github}." },
    languages: {
      title: "English and Chinese",
      text: "The interface follows your system language, or set it in Settings.",
    },
  },
  download: {
    title: "Get started.",
    lead: "Free. Requires macOS 12 or later.",
    button: "Download for {chip}",
    chips: { arm64: "Apple silicon", x64: "Intel" },
    copy: "Copy",
    copied: "Copied",
  },
  footer: {
    license: "MIT License",
    source: "Source",
  },
};
