import { defineMessages } from "../define";

export const settings = defineMessages({
  zh: {
    title: "设置",
    channel: {
      title: "执行方式",
      description: "助手替你找人、填表时用哪个浏览器。",
      userChrome: "在我的 Chrome 里操作",
      recommended: "推荐",
      userChromeDescription:
        "用你已经登录好的 Chrome,你随时能看着它做。任务先排队:桌面应用里的 Claude 会话在线时由它接手,否则 App 自动拉起一个命令行会话(需要 claude 已登录)。",
      headless: "后台浏览器(无人值守)",
      headlessDescription: "用一个独立、持久的浏览器档案在后台操作,不占用你的 Chrome;第一次使用前要在里面登录一次。不支持找内推。",
      openProfile: "打开后台浏览器,登录一次",
      openProfileHint: "换了密码或登录失效时再点一次。",
      toastUserChrome: "之后的任务会在你的 Chrome 里操作",
      toastHeadless: "之后的任务会用后台浏览器",
      openedTitle: "已打开后台浏览器",
      openedDescription: "在弹出的窗口里登录一次 LinkedIn、Workday 等站点,登录状态会保留给之后的后台任务。",
      openFailed: "打开失败",
    },
    language: {
      title: "语言",
      description: "界面、通知和提示的语言。",
      switched: "已切换到中文",
    },
    theme: {
      title: "外观",
      light: "浅色",
      dark: "深色",
      system: "跟随系统",
    },
    notifications: {
      title: "通知",
      description: "助手需要你确认或补信息时,会弹桌面通知;配置了手机推送就也会推到手机。",
      phonePush: "手机推送",
      configured: "已配置",
      notConfigured: "未配置",
      howTo: {
        before: "在项目根目录的 ",
        env: ".env",
        middle: " 里设置 ",
        key: "NTFY_TOPIC=",
        after: " 一个自选的长随机名,并在手机的 ntfy 应用里订阅同名频道,然后重启 Sortie。",
      },
    },
    sources: {
      title: "信息源",
      description: "后台按层级自动轮询各公司的招聘系统,不需要你操心;这里只看最近一次的结果。",
      lastTick: (when: string, boards: number, inserted: number) => `上次检查 ${when}:问了 ${boards} 个板块,新增 ${inserted} 个职位`,
      errors: (n: number) => `,${n} 个出错`,
      period: "。",
      noTick: "还没有检查记录。",
      advanced: "信息源高级页",
    },
  },
  en: {
    title: "Settings",
    channel: {
      title: "How tasks run",
      description: "Which browser the assistant uses when it finds people and fills forms for you.",
      userChrome: "In my Chrome",
      recommended: "Recommended",
      userChromeDescription:
        "Uses the Chrome you are already signed in to, so you can watch it work. Tasks queue first: a Claude session in the desktop app picks them up when it is online; otherwise the app starts a command-line session (claude must be logged in).",
      headless: "Background browser (unattended)",
      headlessDescription:
        "Works in a separate, persistent browser profile in the background without touching your Chrome; sign in there once before first use. Cannot find referrals.",
      openProfile: "Open the background browser to sign in",
      openProfileHint: "Click again if you changed a password or a login expired.",
      toastUserChrome: "Future tasks will run in your Chrome",
      toastHeadless: "Future tasks will use the background browser",
      openedTitle: "Background browser opened",
      openedDescription: "Sign in to LinkedIn, Workday and the like in the window that opened; the sessions are kept for later background tasks.",
      openFailed: "Could not open it",
    },
    language: {
      title: "Language",
      description: "Language of the interface, notifications and messages.",
      switched: "Switched to English",
    },
    theme: {
      title: "Appearance",
      light: "Light",
      dark: "Dark",
      system: "System",
    },
    notifications: {
      title: "Notifications",
      description: "A desktop notification appears when the assistant needs a confirmation or an answer; with phone push configured it reaches your phone too.",
      phonePush: "Phone push",
      configured: "Configured",
      notConfigured: "Not configured",
      howTo: {
        before: "Set ",
        env: ".env",
        middle: " in the project root with ",
        key: "NTFY_TOPIC=",
        after: " a long random name of your choice, subscribe to that topic in the ntfy app on your phone, then restart Sortie.",
      },
    },
    sources: {
      title: "Sources",
      description: "Company job boards are polled automatically in tiers; nothing to manage here. This only shows the latest check.",
      lastTick: (when: string, boards: number, inserted: number) =>
        `Last check ${when}: ${boards} ${boards === 1 ? "board" : "boards"} polled, ${inserted} new ${inserted === 1 ? "job" : "jobs"}`,
      errors: (n: number) => `, ${n} ${n === 1 ? "error" : "errors"}`,
      period: ".",
      noTick: "No checks recorded yet.",
      advanced: "Advanced sources page",
    },
  },
});
