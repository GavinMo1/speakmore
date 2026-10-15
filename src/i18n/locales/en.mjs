// 英文：默认的语言，也是别的语言缺了哪句时的退路。别的语言照着这一份的结构写，名字和参数一一对上。
// {名字} 是参数；{ one, other } 是按 count 分单复数（Intl.PluralRules 的分法）。
// 给人看的一句话句尾不带标点（它常要接在别的话后面），整句的说明才带。

export default {
  common: {
    sentence: "{text}.",
    unknownReason: "unknown reason",
    close: "Close",
  },

  units: {
    seconds: "{value}s",
    minutesSeconds: "{minutes}m {seconds}s",
    minutes: "{minutes} min",
    hoursMinutes: "{hours} hr {minutes} min",
    min: "min",
    hr: "hr",
    words: { one: "word", other: "words" },
    wpm: "WPM",
    days: { one: "day", other: "days" },
  },

  periods: {
    today: "Today",
    month: "This month",
    total: "All time",
  },

  months: {
    jan: "Jan",
    feb: "Feb",
    mar: "Mar",
    apr: "Apr",
    may: "May",
    jun: "Jun",
    jul: "Jul",
    aug: "Aug",
    sep: "Sep",
    oct: "Oct",
    nov: "Nov",
    dec: "Dec",
  },

  permissions: {
    microphone: "Microphone",
    listen: "Input Monitoring",
    trusted: "Accessibility",
    granted: "Granted",
    denied: "Not granted",
    checking: "Checking…",
    openSettings: "System Settings",
    request: "Allow",
  },

  hotkeys: {
    right_option: { name: "Right Option", keycap: "Right ⌥" },
    right_command: { name: "Right Command", keycap: "Right ⌘" },
    right_control: { name: "Right Control", keycap: "Right ⌃" },
    fn: { name: "Globe (fn)", keycap: "fn" },
  },

  themes: {
    ink: { name: "Ink", describe: "Black and white. Shape and motion show the state; color only for errors" },
    cinnabar: { name: "Cinnabar", describe: "A warm red on the wave and the main buttons" },
    indigo: { name: "Indigo", describe: "Color shows the stage: green listening, indigo refining, amber trouble" },
  },

  providers: {
    gemini: { getKey: "Get one at Google AI Studio" },
    openai: { getKey: "Get one at OpenAI Platform" },
  },

  language: {
    system: "System",
  },

  settings: {
    describe: {
      hotkey: "Which key starts and stops dictation",
      model:
        "Which provider and model refines your words, as provider/model; a provider alone uses its default. Switch with speakmore model",
      thinking: "Gemini's thinking level; higher is slower. Other providers don't use it",
      theme: "Which theme the windows use",
      language: "Interface language; system follows your Mac",
    },
    unknown: "There's no setting called {name}. You can change: {names}",
    notText: "must be text",
    oneOf: "must be one of {choices}",
    invalid: "{where} is {value}: {reason}",
    whereEnv: "The {variable} env var",
    whereFile: "{name} in the settings file {file}",
    unreadable: "Can't read the settings file {file} ({reason}). Fix it, or delete it and set things again.",
    notObject:
      'The settings file {file} isn\'t a set of "name": value pairs. Fix it, or delete it and set things again.',
  },

  models: {
    empty: "is empty",
    unknownProvider: "unknown provider {name}; available: {providers}",
    badName: "model name {model} is invalid: only letters, digits, and . _ : - are allowed",
    invalidChoice: "model {reason}",
  },

  setup: {
    openSettings: "menu bar icon › Settings",
    missing: {
      key: "{provider} API key",
      check: "{provider} check",
      microphone: "microphone access",
      listen: "Input Monitoring access",
      helper: "key listener",
    },
    blocker: {
      noKey: "No {provider} API key: {where}",
      checkFailed: "{provider} check failed: {problem}",
      keyRejected: "API key not working: {problem}",
      checking: "Checking the API key, one moment",
      noMicrophone: "No microphone access: {where}",
    },
    degraded: "No Accessibility access: text goes to the clipboard, press ⌘V",
  },

  key: {
    empty: "No key entered",
    tooLong: "This key is too long ({length} characters). Looks like a copy mistake",
    whitespace: "This key has spaces or line breaks. Looks like extra text got copied",
    badCharacters: "This key has characters that don't belong. Looks like a copy mistake",
    unreadable: "The saved key can't be read anymore. Enter it again",
    unreadableFor: "The saved {provider} key can't be read anymore. Enter it again",
    notSaved: "The key works but wasn't saved ({reason}). You'll need to enter it again after quitting",
    keychainUnavailable: "The system keychain isn't available, so the key can't be stored safely",
    external: "Connected to a separately started server (SPEAKMORE_SERVER_URL); set the key there",
    externalModel: "Connected to a separately started server (SPEAKMORE_SERVER_URL); the model is chosen there",
    noKeyFor: "No {provider} key yet. Add one first",
    noKeyForCli: "No {provider} key yet: run speakmore key {id}",
    unknownProvider: "Unknown model provider: {id}",
    noKeyService:
      "No {provider} API key yet: run speakmore key in a terminal, or open Settings from the SpeakMore menu bar icon",
  },

  model: {
    timeout: "{provider} took too long to reply. Try again later",
    unreachable: "Can't reach {provider}. Check your network",
    keyInvalid: "This key is invalid. Check it was copied in full",
    unavailable: "{provider} is unavailable right now ({said}). Try again later",
    rejected: "{provider} rejected the request: {said}",
    regionBlocked:
      "{provider} isn't available in your network's region ({said}). Check your proxy or switch networks; the key is fine",
    noQuota: "This key's account is out of credit. Top up or use another key",
    forbidden: "This key lacks permission: {said}",
    notFound: "{provider} doesn't have this model, or this key can't use it: {said}",
    blocked: "{provider} didn't process this recording: {reason}",
    unfinished: "{provider} didn't finish normally: {reason}",
  },

  audio: {
    undecodable: "Couldn't decode the recording ({type}): {reason}",
    empty: "Couldn't decode the recording ({type}): it has no audio",
  },

  voice: {
    noAudio: "No audio received",
    connectTimeout: "Timed out connecting to the server",
    unreachable: "Can't reach the server at {url}",
    disconnected: "Lost the connection to the server",
    timeout: "No result after {seconds} seconds",
    serverError: "Server error {code}: {detail}",
  },

  delivery: {
    silent: "Didn't hear anything",
    noAccessibility: "No Accessibility access: text copied, press ⌘V to paste",
    pasteFailed: "Couldn't paste: text copied, press ⌘V to paste",
  },

  bar: {
    opening: "Opening microphone…",
    recording: "Press {key} to finish · {esc} to cancel",
    recordingNoEsc: "Press {key} to finish",
    finishing: "Refining",
    noHold: "No need to hold: press once to start, again to finish",
    noMicPermission: "No microphone access: System Settings › Privacy & Security › Microphone",
    noMicrophone: "No microphone found",
    noSignal: "The microphone isn't picking anything up: check the input device and mute",
    recordError: "Recording error: {reason}",
    helperStopped: "Key listener stopped; {hotkey} won't work. Try restarting SpeakMore",
  },

  tray: {
    ready: "Ready · press {keycap} to talk",
    missing: "Missing: {items}",
    preparing: "Getting ready…",
    open: "Open SpeakMore",
    history: "History",
    settings: "Settings…",
    version: "Version {version}",
    quit: "Quit SpeakMore",
    fallbackTitle: "Dictate",
  },

  notes: {
    saveFailed: "Switched to {provider}, but couldn't save it to settings ({reason}) · next launch goes back",
    envNextLaunch: "The {variable} env var takes priority · next launch still uses it",
    envRemove: "The {variable} env var takes priority · remove it to apply",
  },

  hub: {
    pages: "Pages",
    home: "Home",
    history: "History",
    settings: "Settings",
    about: "About",
    missing: "Missing: {items}",
    fix: "Settings",
  },

  home: {
    title: "Speak, don't type",
    words: "Words",
    saved: "Time saved",
    speed: "Speed",
    time: "Dictation time",
    active: "Active",
    streak: "Streak",
    longest: "Longest",
    activity: "Dictations per day",
    earlier: "Earlier",
    later: "Later",
    less: "Less",
    more: "More",
    notStarted: "{day} · not started yet",
    dayCount: { one: "{day} · {count} dictation · {level}", other: "{day} · {count} dictations · {level}" },
    dayLevel: "{day} · {level}",
    levels: {
      none: "No activity",
      light: "Light usage",
      moderate: "Moderate usage",
      high: "High usage",
      power: "Power usage",
    },
    spend: "Spent this month",
    cost: "Cost",
    tokens: "Tokens",
    count: "Count",
    latency: "Latency",
    unpriced: "{models} unpriced; {count} not counted",
    dictate: "Press to talk",
  },

  history: {
    title: "History",
    empty: "Nothing yet · press {keycap} to say something",
    loadError: "Couldn't read history: {reason}",
    today: "Today",
    yesterday: "Yesterday",
    silent: "Audio is silent",
    failed: "Failed · ",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed",
    recording: "Recording {duration}",
    model: "Model {latency} · {cost}",
    tokens: "In {input} · out {output} tokens",
    tokensCalls: "In {input} · out {output} tokens · {calls} calls",
    unpriced: "price unknown",
  },

  preferences: {
    title: "Settings",
    sections: "Settings sections",
    general: "General",
    model: "Model",
    permissions: "Permissions",
    about: "About",
    hotkey: "Shortcut",
    theme: "Theme",
    language: "Language",
    openAtLogin: "Launch at login",
    hotkeyFailed: "Not changed: {reason}",
    themeFailed: "Theme not changed: {reason}",
    languageFailed: "Language not changed: {reason}",
    loginFailed: "Couldn't set launch at login: {reason}",
    recheck: "Check again",
    version: "Version",
    dataFolder: "Data folder",
    source: "Source code",
  },

  keyPanel: {
    models: "Model",
    inUse: "In use",
    use: "Use {provider}",
    placeholder: "Paste key",
    paste: "Paste",
    save: "Save & verify",
    saveAndUse: "Save & use {provider}",
    forget: "Delete key",
    verifying: "Verifying…",
    failed: "Didn't work: {reason}",
    clipboardEmpty: "Clipboard is empty",
    confirmForget: "Delete the {provider} key?",
    confirmForgetInUse: "Delete the {provider} key? You'll need to add it again to dictate",
    other: {
      env: "The {variable} env var has one",
      stored: "One saved",
      none: "None · add one to switch to {provider}",
    },
    state: {
      env: "Using the {variable} env var · not saved",
      envUnverified: "Using the {variable} env var · not saved · not verified (couldn't reach {provider} at launch)",
      external: "Set by the separately started server",
      saved: "Saved · verified",
      savedUnverified: "Saved · not verified (couldn't reach {provider} at launch)",
      checking: "Verifying…",
      checkFailed: "Check failed: {problem} · the key may be fine; see speakmore model",
      envRejected: "The key in the {variable} env var doesn't work: {problem} · fix or remove it, then restart",
      rejected: "This key doesn't work: {problem}",
      missing: "Not set",
    },
  },

  onboarding: {
    groups: { key: "Model", setup: "Set up", try: "Try it" },
    key: {
      soft: "Connect a ",
      title: "model",
      spoken: "“Um, let's meet at nine tomorrow, no wait, nine thirty…”",
      result: "Let's meet at 9:30 tomorrow.",
    },
    permissions: {
      soft: "Turn on three ",
      title: "permissions",
      allow: "Allow",
      on: "✓ On",
      history: "History stays on this Mac",
      audio: "Audio goes only to your model",
      key: "Key encrypted on this Mac",
    },
    microphone: {
      soft: "Speak to ",
      title: "test the mic",
      question: "Are the bars moving?",
      yes: "Yes, continue",
      no: "No",
      help: "Check the input device and volume in System Settings › Sound, or turn on",
      settings: "Microphone access",
      error: "Can't open the microphone: {reason}",
    },
    hotkey: {
      soft: "Press it to ",
      title: "test the shortcut",
      question: "Did the key light up?",
      yes: "Yes, continue",
      no: "No, pick another key",
      switchTo: "Switch to",
      switched: "Switched. Press it to try",
      failed: "Not switched: {reason}",
    },
    try: {
      soft: "Now, ",
      title: "say something",
      sample: "Um, let's meet tomorrow at nine, no wait, nine thirty, and bring last week's numbers.",
      notes: "Notes",
      placeholder: "Click here, press {keycap}, read the line on the left, then press it again",
    },
    done: { soft: "Speak, ", title: "don't type", start: "Get started" },
    back: "Back",
    next: "Continue",
    skip: "Skip",
  },

  paths: {
    homeNotAbsolute: "The SPEAKMORE_HOME env var must be an absolute path; it's {home}",
    homeTooLong:
      "The SpeakMore folder path is too long for the control socket: {home}\nUse the SPEAKMORE_HOME env var to pick a shorter one.",
  },

  control: {
    notRunning: "SpeakMore isn't running",
    timeout: "SpeakMore didn't reply within {seconds} seconds (command {command})",
    unreadable: "Couldn't understand SpeakMore's reply (command {command})",
  },

  storage: {
    historyTooNew:
      "The history database is version {found}, newer than this program knows ({known}), so it won't touch it",
    historyTooOld:
      "The history database is version {found}, but this program expects {known}: start SpeakMore once, or update to the latest version",
    legacyRunning:
      "An old version of SpeakMore is still running, so its data can't be moved. Quit it first (menu bar → Quit), then run this again.",
  },

  cli: {
    help: `SpeakMore: press a hotkey, speak, and polished text is pasted into the current text box.

  speakmore                     Start (just shows status if already running). First run asks for an API key (Gemini by default)
  speakmore start               Same as above
  speakmore stop                Stop
  speakmore restart             Restart
  speakmore status [--json]     Status: running or not, key, the three macOS permissions, how much you said today and in total

  speakmore history [-n count] [--json]
                                What you said, grouped by day, newest first (latest {limit} by default)
  speakmore usage [--json]      What it cost: spend and tokens today, this month, and in total, model reply times, per model
  speakmore model               Available providers ({providers}), whether each has a key, which one is in use
  speakmore model <provider>[/<model>]
                                Switch provider or model, e.g. speakmore model openai. Asks for its key if missing
  speakmore model check [<provider>[/<model>]]
                                Check it works: sends that provider a minimal request with its key. Defaults to the current one
  speakmore key [<provider>]    Replace a key; defaults to the current provider (input is hidden; can also be piped in)
  speakmore key --forget [<provider>]
                                Delete the saved key
  speakmore config              Settings: hotkey, model, thinking level, theme, language, and where data and logs live
  speakmore config set <name> <value>
  speakmore config unset <name> Reset to the default
  speakmore theme               List themes and the one in use
  speakmore theme <name>        Switch theme ({themes}); applies right away, no restart
  speakmore settings            Open Settings (to grant macOS permissions)
  speakmore logs [-n lines] [-f]
                                Show logs; -f keeps following
  speakmore uninstall [--keep-data] [--yes]
                                Uninstall: stop it and delete the whole SpeakMore folder. --keep-data keeps settings, keys, history, and recordings

  speakmore help                This help
  speakmore --version           Version
`,
    macOnly: "SpeakMore only supports macOS for now: listening for the hotkey and pasting rely on macOS system APIs.",
    nodeVersion: "SpeakMore needs Node 22.13 or newer (23.4 or newer on the 23 line); this is {version}.",
    unknownCommand: "There's no command called {name}.",
    seeHelp: "Run speakmore help to see all commands.",
    stuck: "It may be stuck. Run speakmore stop to force it to stop, then run speakmore to start it again.",
    migrated: "Moved the old version's data to {home} ({items}).",
    badArgs: "Invalid arguments: {reason}",
    extraArgs: "Unexpected argument {args}. Usage: {usage}",
    positiveInteger: "{flag} needs a positive integer",
    starting: "Starting SpeakMore…",
    runRestart: "run speakmore restart",
    packagedRelaunch: "click the SpeakMore menu bar icon → Quit SpeakMore, then open SpeakMore.app again",
    syntax: {
      start: "speakmore start",
      stop: "speakmore stop",
      restart: "speakmore restart",
      status: "speakmore status [--json]",
      history: "speakmore history [-n count] [--json]",
      usage: "speakmore usage [--json]",
      logs: "speakmore logs [-n lines] [-f]",
      settings: "speakmore settings",
      uninstall: "speakmore uninstall [--keep-data] [--yes]",
      config: "Usage: speakmore config | speakmore config set <name> <value> | speakmore config unset <name>",
      theme: "Usage: speakmore theme | speakmore theme <name>",
      model:
        "Usage: speakmore model | speakmore model <provider>[/<model>] | speakmore model check [<provider>[/<model>]]",
    },
    lifecycle: {
      openedOnboarding:
        "Opened the setup guide. Grant the missing permissions there, then run speakmore status to check.",
      openedSettings: "Opened Settings. Grant the missing permissions there, then run speakmore status to check.",
      notRunning: "SpeakMore wasn't running.",
      stopped: "SpeakMore stopped.",
      killed: "SpeakMore was stuck and has been force-quit.",
      packagedRestart:
        "The running SpeakMore is SpeakMore.app in Applications. Restarting it from the command line would swap in a terminal-launched copy with separate permissions and keys.",
      howToRestart: "To restart it: {relaunch}.",
    },
    key: {
      prompt: "Paste the key and press Enter (input is hidden): ",
      need: "SpeakMore needs a {provider} API key: recordings are sent to {provider} to become text.",
      getOne: "Don't have one? Get one here: {url}",
      storage: "It's encrypted with the system keychain and stays on this Mac.",
      skip: "Press Enter to skip for now.",
      legacyDaemon:
        "The running SpeakMore is an old version that only knows Gemini keys: {restart} first, then try again.",
      verifying: "Verifying…",
      saved: "Key saved and verified.",
      rejected: "This key didn't pass: {problem}",
      notInline:
        "Don't put the key after the command: it would stay in your shell history. Run speakmore key and paste it, or pipe it in: pbpaste | speakmore key. To set one for a specific provider, add its name: {providers}",
      forgotten: "Deleted the saved {provider} key.",
      cancelled: "Cancelled; the key is unchanged.",
      nothingRead: "No key read; the old one is unchanged.",
      badShapeUnchanged: "{problem}. The old one is unchanged.",
      switchHint: "To use it: speakmore model {id}",
    },
    config: {
      nextLaunch: "Takes effect next launch.",
      packaged: "The running SpeakMore is SpeakMore.app in Applications. To apply the new settings: {relaunch}.",
      restarting: "Restarting SpeakMore to apply…",
      restartedBroken: "Restarted, but it can't be used now: {problem}",
      undo: "To undo this change: {undo}",
      restartedKeyBad:
        "Restarted, but the {provider} key doesn't work: {problem}. Run speakmore key {id} to replace it",
      restartedNoKey: "Restarted, but there's no {provider} key yet, so it can't be used: run speakmore key {id}",
      restartedStarting: "Restarted, but not ready yet: run speakmore status to check.",
      restartedUnverified:
        "Restarted, but couldn't reach {provider}, so the new settings aren't verified yet: run speakmore status in a bit.",
      applied: "Applied.",
      oldDaemonLive: "The running SpeakMore is an old version and won't switch on the fly: run speakmore restart.",
      appliedLive: "Applied, no restart needed.",
      themeOverridden:
        "The running SpeakMore still uses {theme}: {variable} is set where it was started, and it overrides the settings file.",
      languageOverridden:
        "The running SpeakMore still uses {language}: {variable} is set where it was started, and it overrides the settings file.",
      envWarning: "Note: the {variable} env var is set and overrides this value.",
      changed: "{name} set to {value}.",
      unset: "{name} reset to the default, {value}.",
      themeChanged: "Theme set to {theme}.",
      notRunning: "SpeakMore isn't running. Run speakmore to start it first.",
      settingsOpened: "Settings opened.",
      title: "Settings",
      choices: "{describe}. Options: {choices}",
      hintSet: "Change one: speakmore config set hotkey fn",
      hintUnset: "Reset one: speakmore config unset hotkey",
      hintKey: "Replace the key: speakmore key",
      hintTheme: "Switch theme: speakmore theme",
      folder: "Folder",
      settingsFile: "Settings file",
      log: "Log",
      oneFolder: "The program, settings, keys, history, and recordings all live in this one folder.",
      uninstallHint: "Done with it? speakmore uninstall stops it and deletes the whole folder.",
    },
    source: {
      default: "default",
      file: "from the settings file",
      env: "from the {variable} env var this run",
    },
    themeTitle: "{name} ({id})",
    themes: {
      title: "Themes",
      current: "Using {theme} · {source}",
      switch: "Switch: speakmore theme {id} (applies right away, no restart)",
    },
    model: {
      unknownProvider: "Unknown provider {name}; available: {providers}. To pick a model, write provider/model",
      invalid: "Model is {value}: {reason}",
      describe: "{provider} {model}",
      option: "default {model}",
      optionWithKey: "default {model}, key already set",
      choose: "First, pick whose model turns your recordings into text (change it later with speakmore model):",
      choosePrompt: "Enter a number and press Enter (just Enter picks {fallback}): ",
      choosePromptAgain: "Enter a number and press Enter: ",
      choiceItem: "{number} ({name})",
      noSuchChoice: "There's no option {answer}; choose {choices}.",
      noKeyNonInteractive: "No {provider} key yet, so nothing changed: run speakmore key {id} first, then switch.",
      notSwitched: "Not switched: no {provider} key yet.",
      switched: "Model switched to {model}.",
      checking: "Checking {model}…",
      oldDaemonCheck:
        "The running SpeakMore is an old version and can't check: run speakmore restart, then check again.",
      unusable: "Not usable: {problem}",
      usable: "Works: {model}, using {from}, round trip {seconds}s.",
      fromEnv: "the key in the {variable} env var",
      fromStored: "the saved key",
    },
    models: {
      title: "Models",
      default: "{model} (default)",
      keyStored: "key saved",
      keyEnv: "key from the {variable} env var",
      noKey: "no key yet",
      current: "Using {provider} {model} · {source}",
      switch: "Switch provider: speakmore model {id} (asks for its key if missing)",
      pick: "Pick a model: speakmore model {id}/{model}",
      check: "Check it works: speakmore model check (no argument checks the current one)",
    },
    status: {
      notRunning: "not running",
      runToStart: "Run {command} to start it.",
      starting: "starting",
      running: "running",
      missingCount: { one: "running, {count} thing missing", other: "running, {count} things missing" },
      preparing: "running, getting ready",
      ready:
        "Ready: click into any text box, press {hotkey} to start talking, press it again to finish, and the text gets pasted in.",
      missing: "Missing: {items}.",
      key: "Key",
      permissions: "Permissions",
      hotkey: "Hotkey",
      model: "Model",
      theme: "Theme",
      language: "Language",
      today: "Today",
      total: "All time",
      modelExternal: "decided by the separately started server",
      modelInUse: "{provider} {model}",
      modelWithThinking: "{provider} {model} ({thinking})",
      keyEnv: "Using the one in the {variable} env var this run, not saved",
      keyEnvUnverified:
        "Using the one in the {variable} env var this run, not saved; couldn't reach {provider} at launch, so it isn't verified yet",
      keyExternal: "Connected to a separately started server; the key is set there",
      keySaved: "Saved and verified",
      keySavedUnverified: "Saved; couldn't reach {provider} at launch, so it isn't verified yet",
      keyChecking: "Verifying…",
      keyCheckFailed: "Check failed: {problem}. The key may be fine; check the {what} first: speakmore config",
      modelAndLevel: "model and thinking level",
      modelOnly: "model",
      keyEnvRejected:
        "The key in the {variable} env var doesn't work: {problem}. Fix it or remove the variable, then restart",
      keyRejected: "Not working: {problem}. Run speakmore key to replace it",
      keyUnreadable: "{problem}: run speakmore key",
      keyMissing: "Not set: run speakmore key",
      dictations: { one: "{count} dictation", other: "{count} dictations" },
      characters: { one: "{count} character", other: "{count} characters" },
      pace: "{count} characters/min",
      atLeast: "at least {cost}",
      costUnknown: "cost unknown",
      pending: "Changed in settings but not applied yet ({names}): {relaunch}.",
      helperStopped:
        "The key-listening helper stopped, so the hotkey won't work: {relaunch}. If it keeps happening, see speakmore logs.",
      openSettings:
        "Run {command} to open the permissions page in Settings: each permission has a button to System Settings; after turning it on, click “Check again”.",
      ownerApp: "Permissions belong to the app itself; look for “SpeakMore” in the System Settings lists.",
      ownerTerminal:
        "Permissions belong to the terminal app that started SpeakMore (e.g. Terminal or iTerm); look for it in the System Settings lists.",
      footer: `speakmore history  what you said     speakmore config  view and change settings
speakmore usage    what it cost      speakmore stop    stop it
speakmore help     all commands`,
    },
    history: {
      empty: "No dictations yet. Run {command} to start, then press the hotkey and say something.",
      today: "Today · {date}",
      yesterday: "Yesterday · {date}",
      failed: "✗ Failed: {reason}",
      recording: "Recording {seconds}s, kept at {path}",
      notSaved: "(not saved)",
      more: "Showing the latest {shown} of {total}. Run speakmore history -n {total} to see all.",
    },
    usage: {
      empty: "No usage yet. Say something first: every model call's cost, tokens, and reply time get recorded.",
      title: "Usage",
      cost: "Cost",
      tokens: "Tokens",
      dictations: "Dictations",
      latency: "Model reply",
      waiting: "usually {median}, slow {slow}",
      usually: "usually {median}",
      unpriced: "price unknown",
      times: { one: "{count} dictation", other: "{count} dictations" },
      byModel: "By model (all time)",
      tokensNote:
        "All-time tokens: input {input} (audio {audio}, cached {cached}), output {output} (thinking {thinking}).",
      checksNote: { one: "Includes {count} key check.", other: "Includes {count} key checks." },
      cacheNote: "{cost} of the cost is prompt caching (creating and keeping it).",
      unpricedNote: "{models} aren't in the price list; those {count} calls aren't counted.",
      estimateNote:
        "Costs are USD estimates at each provider's standard price; Gemini use within the free tier is actually free.",
    },
    logs: {
      none: "No logs yet: SpeakMore writes them to {file} once it has started",
    },
    uninstall: {
      yours: "settings, keys, history, and recordings",
      needsConfirm: "Uninstalling needs confirmation. Add --yes when not running in a terminal.",
      planKeep: "About to uninstall SpeakMore: delete the program and runtime in {home}, keeping your {yours}.",
      planAll:
        "About to uninstall SpeakMore: delete all of {home}, including the program, runtime, and your {yours}. This can't be undone.",
      confirm: "Are you sure? Type y and press Enter: ",
      aborted: "Nothing changed.",
      removedKeep: "the program, runtime, logs, and cache in {home}",
      keychainItem: "the keychain item used to encrypt keys",
      keychainFailed:
        "The keychain item used to encrypt keys wasn't deleted ({reason}): search for SpeakMore in Keychain Access and delete it by hand",
      removedAll: "{home} (the program, runtime, and your {yours})",
      done: "SpeakMore uninstalled.",
      removed: "Deleted: {item}",
      kept: "Kept: your {yours} in {home}. Reinstall to pick up where you left off; delete the folder if you don't need them",
      leftovers: "Still on your system:",
      permissions:
        "Microphone, Input Monitoring, and Accessibility access for your terminal is untouched: it belongs to the terminal app and can be turned off in System Settings → Privacy & Security",
      sharedPrefs:
        "{file} is untouched: a small file where the runtime remembers things like window sizes, shared by every app built on stock Electron",
      sourceDir: "Source folder is untouched: {dir}",
    },
    daemon: {
      noElectron: "Can't find Electron: dependencies aren't fully installed. Run npm install in {dir} and try again.",
      downloading: "First launch: downloading the Electron runtime (about 100 MB)…",
      downloadFailed: "Electron didn't download ({reason}). Check your network and run this again.",
      emptyLog: "(the log is empty)",
      micPrompt: "macOS is asking for microphone access: click “Allow” (the dialog shows your terminal app's name).",
      verifying: "Verifying key…",
      building: "First launch: building the key-listening helper…",
      signal: "ended by signal {signal}",
      exitCode: "exit code {code}",
      exitedEarly: "exited midway",
      failed: "SpeakMore failed to start ({reason}). Last lines of the log {file}:\n{tail}",
      noAnswer: "SpeakMore didn't respond within {seconds} seconds of starting. Check the log: {file}",
      stuckNoPid:
        "SpeakMore is stuck and not answering, and its process can't be identified. Find the process named Electron or SpeakMore in Activity Monitor and quit it.",
      cantStop: "Can't stop SpeakMore (PID {pid}). Quit it in Activity Monitor.",
      needXcode:
        "Building the key-listening helper needs the Xcode Command Line Tools. Run this first: xcode-select --install",
      buildFailed:
        "The key-listening helper didn't build (if the Xcode Command Line Tools aren't installed, run xcode-select --install first):\n{detail}",
    },
  },
};
