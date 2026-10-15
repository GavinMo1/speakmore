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
    download: "Download",
    chip: "Apple silicon",
    intel: "Intel Mac",
    facts: ["Free", "Open source", "macOS 12+"],
    shotAlt: "SpeakMore's home window: words, time saved, pace, a daily heatmap and spend",
    barAlt: "The floating bar during dictation: cancel, a live waveform, done",
  },
  demo: {
    title: "Speak naturally.\nRead polished text.",
    lead: "Filler words, repetitions and self-corrections are removed. Enumerations become lists.",
    said: "Spoken",
    written: "Written",
    note: "Actual output: synthesized speech, cleaned up by Gemini 3.6 Flash.",
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
    cancel: "Press {esc} to cancel",
    speedValue: "≈2 s",
    speedLabel: "from end of speech to text",
    apps: "Slack, Notion, VS Code, WeChat, Chrome, Gmail and more",
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
    note: "Estimated from the author's real use, Jun–Sep 2026: 430–870 dictations and 4.5–7 hours of audio a month, at Gemini 3.6 Flash list prices with prompt caching. Google doubles 3.6 Flash prices on Jan 1, 2027, which puts it at about $1.30–2.10 a month.",
  },
  privacy: {
    title: "Straight to the model.\nNothing in between.",
    lead: "No account, no intermediary server, no analytics.",
    mac: "Your Mac",
    key: "your key",
    provider: "Gemini or OpenAI",
    middle: "Intermediary server",
    none: "None",
    points: [
      { icon: "key", title: "Keychain encryption", text: "Your key is encrypted by the macOS Keychain." },
      { icon: "drive", title: "Local history", text: "Your history never leaves your Mac." },
      { icon: "eyeOff", title: "No screen reading", text: "Only audio is sent, nothing else." },
      { icon: "code", title: "Open source", text: "Every line of code is on GitHub." },
    ],
  },
  models: {
    title: "Gemini or OpenAI.\nYour choice.",
    lead: "Add your own key. Switch providers in one click.",
    default: "Default",
    gemini: {
      name: "Gemini",
      model: "gemini-3.6-flash",
      facts: ["Most thorough cleanup", "Text in about 2 s", "Free tier available", "Prompt caching"],
    },
    openai: {
      name: "OpenAI",
      model: "gpt-audio-mini",
      facts: ["Text in 2–5 s", "Lighter cleanup"],
    },
  },
  language: {
    title: "Mandarin, English,\nor both at once.",
    lead: "Tuned for Mandarin, with English terms kept intact. English-only dictation works as well.",
    said: "明天的 standup 改到十点吧，然后记得 review 一下那个 PR。",
    written: "明天的 standup 改到 10 点吧，然后记得 review 一下那个 PR",
    ui: "Interface",
    uiLanguages: ["English", "简体中文"],
    uiNote: "Follows your system setting.",
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
  open: {
    title: "Open source.\nMIT licensed.",
    lead: "Read, modify and build it yourself.",
    cta: "View on GitHub",
  },
  download: {
    title: "Get started.",
    lead: "Free. Signed and notarized by Apple.",
    appleSilicon: "Apple silicon",
    appleSiliconNote: "M1 and later",
    intel: "Intel",
    intelNote: "Macs with Intel processors",
    terminal: "Or install from Terminal",
    copy: "Copy",
    copied: "Copied",
    needs: "Requires macOS 12 or later and a {gemini} (free tier available) or an {openai}.",
    geminiKey: "Gemini key",
    openaiKey: "OpenAI key",
    version: "Version {version}",
  },
  footer: {
    license: "MIT License",
    source: "Source",
  },
};
