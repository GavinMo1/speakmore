// 英文文案。和 zh-CN.js 的结构一一对应（test/i18n.test.mjs 会查），改一份就改两份。
// 写法：书面语，短词短句，不用口语和俏皮话；数字都要有出处（README 的评测、成本两节，bench/results/ 的实测），页面上不写出处。
// 标题里的 \n 是换行的位置；口述里 ~~ 括起来的是会被删掉的部分。

export default {
  meta: {
    title: "SpeakMore — Voice dictation for Mac and Windows",
    description:
      "Press a key, speak, and polished text appears where you type. Free and open source. Your model, your mode, your cost.",
  },
  nav: {
    ways: "Modes",
    speed: "Speed",
    models: "Models",
    privacy: "Privacy",
    developers: "Developers",
    download: "Download",
    github: "SpeakMore on GitHub",
    home: "SpeakMore home",
  },
  hero: {
    title: "Speak more.\nType less.",
    lead: "Voice dictation for Mac and Windows.\nYour model, your mode, your cost.",
    shotAlt:
      "SpeakMore's home window: words, time saved, pace, dictation time and a daily heatmap, with the mode picker at the top right",
    barAlt: "The floating bar during dictation: cancel, a live waveform, done",
  },
  demo: {
    title: "Speak naturally.\nRead polished text.",
    lead: "Press a key to start and again to stop. Filler words, repetitions and self-corrections are removed. Enumerations become lists.",
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
  models: {
    title: "Leading models.\nAny you like.",
    lead: "Pick native, transcription and polish models separately. Any OpenAI-compatible service works too.",
    loopLabel: "Supported model providers",
    vendors: {
      gemini: "Google Gemini",
      openai: "OpenAI",
      qwen: "Qwen",
      bailian: "Alibaba Cloud Bailian",
      deepseek: "DeepSeek",
      kimi: "Kimi",
      zhipu: "Zhipu",
      minimax: "MiniMax",
      funaudiollm: "SenseVoice",
      custom: "Custom service",
    },
    points: [
      { title: "Your own keys", text: "Encrypted on this computer. Change them anytime." },
      { title: "Measured, not guessed", text: "Benchmarked models show their scores." },
      { title: "Switch instantly", text: "No restart needed." },
    ],
    shotAlt:
      "The Polish tab of the Models page: DeepSeek, Qwen, Kimi, Zhipu, MiniMax and more, with prices and benchmark scores",
  },
  ways: {
    title: "Three modes.\nSwitch anytime.",
    lead: "Switch from the home window. Each mode keeps its own models.",
    lanes: { cloud: "Cloud", device: "Device", offline: "Offline" },
    items: [
      {
        id: "native",
        name: "Native",
        text: "Audio goes straight to the model. One pass.",
        facts: ["Uploads audio", "Needs an API key"],
        steps: ["Audio", "Model", "Text"],
        carry: "Audio",
      },
      {
        id: "local",
        name: "Transcribe + Polish",
        text: "Transcribed on device, polished by any model.",
        facts: ["Uploads text only", "Needs an API key"],
        steps: ["Audio", "On device", "Polish", "Text"],
        carry: "Text",
      },
      {
        id: "private",
        name: "Private",
        text: "Fully on device. Offline.",
        facts: ["Uploads nothing", "No API key"],
        steps: ["Audio", "On device", "Text"],
      },
    ],
  },
  speed: {
    title: "Fast.\nAnd light.",
    lead: "Runs on processors and graphics cards. Uses the GPU automatically when there is one.",
    headline: {
      label: "Mainstream hardware",
      value: "2",
      prefix: "<",
      unit: "s",
      text: "From releasing the key to text",
    },
    stats: [
      { value: "0.23", unit: "s", label: "On-device transcription", note: "Apple silicon" },
      { value: "850", unit: "MB", label: "On-device model", note: "One-time download" },
    ],
    hardware: {
      label: "Supported hardware",
      groups: [
        {
          id: "cpu",
          name: "Processors",
          note: "Runs directly",
          items: [
            { icon: "apple", brand: "Apple", series: "M series" },
            { icon: "intel", brand: "Intel", series: "Core" },
            { icon: "amd", brand: "AMD", series: "Ryzen" },
          ],
        },
        {
          id: "gpu",
          name: "Graphics",
          note: "Accelerated",
          items: [
            { icon: "nvidia", brand: "NVIDIA", series: "GeForce" },
            { icon: "amd", brand: "AMD", series: "Radeon" },
            { icon: "intel", brand: "Intel", series: "Arc · Iris\u00a0Xe" },
          ],
        },
      ],
    },
    long: {
      title: "Steady on long takes",
      text: "Nearly three minutes of speech, written in full, never cut off.",
      start: "0:00",
      end: "2:52",
    },
  },
  privacy: {
    title: "Your data.\nOn your computer.",
    lead: "In Private mode, audio and text never leave this computer.",
    items: [
      { icon: "offline", title: "No uploads", text: "Transcribed on device" },
      { icon: "account", title: "No account", text: "Open and start" },
      { icon: "key", title: "Encrypted keys", text: "Protected by the system" },
      { icon: "history", title: "Local history", text: "Stays on this computer" },
    ],
    mirror: {
      title: "China mirror.\nOver 10× faster.",
      text: "Download the on-device model from the China mirror (ModelScope): 850 MB in about a minute and a half.",
      alt: "Download speed: China mirror (ModelScope) about 9.8 MB/s, Hugging Face about 0.7 MB/s",
    },
  },
  cost: {
    title: "Free app. No subscription.",
    text: "Pay model providers directly, only for what you use.",
    per: "/ month",
    paid: { name: "Transcribe + Polish", note: "100 dictations a day" },
    free: { name: "Private", note: "Download the model and run AI on your own computer" },
  },
  setup: {
    title: "Three minutes.\nAll set.",
    lead: "Pick a mode, prepare a model, grant access, say a line. Every step can be skipped.",
    steps: [
      "Pick a mode",
      "Prepare model and key",
      "Grant access",
      "Test the microphone",
      "Test the shortcut",
      "Say a line",
      "Start",
    ],
    alt: "Setup step {n}: {step}",
    previous: "Previous step",
    next: "Next step",
  },
  features: {
    label: "More features",
    items: [
      { icon: "translate", title: "English and Chinese", text: "Follows the system language" },
      { icon: "palette", title: "Three themes", text: "Light and dark, automatic" },
      { icon: "dictionary", title: "Dictionary", text: "Names and terms, spelled as listed" },
      { icon: "history", title: "History and spend", text: "Kept locally, always at hand" },
      { icon: "erase", title: "Clean uninstall", text: "One folder, removed in one command" },
    ],
  },
  developers: {
    title: "Command line.\nOn par with the app.",
    lead: "Open source under MIT. Develop the Windows version remotely from a Mac.",
    points: [
      {
        title: "Full command line",
        text: "Switch modes and models, manage keys, download models, check history and spend.",
      },
      { title: "JSON output", text: "status, history and usage print JSON for your scripts." },
      {
        title: "Cross-platform development",
        text: "Sync to Windows over SSH, then test, restart and capture the screen remotely.",
      },
      { title: "Plugin architecture", text: "Every provider implements one interface. Over 1,000 unit tests." },
    ],
    source: "View source on GitHub",
    terminal: { label: "Terminal demo", tabs: { cli: "Command line", windows: "Windows development" } },
    sessions: {
      cli: [
        {
          comment: "Switch modes, effective immediately",
          command: "speakmore mode private",
          output: [
            "Switched to private mode: qwen3-asr-0.6b-q8 on this Mac; no polishing, nothing uploaded.",
            "Switched, no restart needed.",
          ],
        },
        { comment: "Change the theme", command: "speakmore theme indigo", output: ["Theme set to Indigo (indigo)."] },
        {
          comment: "Status as JSON",
          command: "speakmore status --json",
          output: ['{"running":true,"settings":{"mode":{"value":"private",…},…}}'],
        },
      ],
      windows: [
        {
          comment: "Sync, then run every unit test on Windows",
          command: "scripts/dev/win-test.sh",
          output: ["ℹ tests 1047 ℹ pass 1030 ℹ fail 0 ℹ skipped 17"],
        },
        {
          comment: "Restart the app from source, with a debug port",
          command: "scripts/dev/win-app.sh",
          output: ['{"t":"…","level":"info","event":"started","version":"{version}",…}'],
        },
        {
          comment: "Capture the Windows desktop",
          command: "scripts/dev/win-screenshot.sh desktop.png",
          output: ["desktop.png"],
        },
      ],
    },
  },
  download: {
    title: "Get started",
    lead: "Free download. macOS 12 or later; Windows 10 or later (64-bit).",
    buttons: { arm64: "Download for Apple silicon", windows: "Download for Windows" },
    intel: "Mac with Intel",
    terminal: { mac: "macOS · Terminal", windows: "Windows · PowerShell" },
    copy: "Copy",
    copied: "Copied",
  },
  footer: {
    license: "MIT license",
    source: "Source",
    switchTo: "中文",
    switchLabel: "切换到中文",
  },
};
