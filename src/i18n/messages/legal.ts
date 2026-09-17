import { defineMessages } from "../define";

// The two public documents Google's sign-in branding links to (and every account should be able
// to read): /privacy and /terms. Each document is a title, an intro paragraph and a list of
// sections; a section body is a list of blocks, where a string is a paragraph and an array of
// strings is a bullet list. Both languages must keep the same number of sections and blocks.
//
// The text describes what Sortie actually does today (one box, SQLite, Claude does the reading,
// nothing is submitted or sent without the user's confirmation). When that changes, change this.

export type LegalBlock = string | readonly string[];
export interface LegalSection {
  readonly h: string;
  readonly body: readonly LegalBlock[];
}
export interface LegalDoc {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

export const legal = defineMessages({
  zh: {
    updatedLabel: "最后更新",
    backToLogin: "回到登录",
    backToApp: "回到 Sortie",
    operatorLine: "运营者:Mengjia Shang(个人项目)",
    privacy: {
      title: "隐私政策",
      intro:
        "Sortie 是 Mengjia Shang(下称「运营者」)自己搭建、自己运营的求职助手,通过私有网络提供给一小圈人使用,不是商业服务。这份文件说明 Sortie 会保存你的哪些信息、拿来做什么、谁能看到,以及怎样删除。",
      sections: [
        {
          h: "1. Sortie 保存哪些信息",
          body: [
            [
              "账号:你的姓名、邮箱和经过哈希处理的密码;如果你用 Google 登录,则是 Google 返回的邮箱、姓名和头像。Sortie 只向 Google 申请最基本的登录权限(openid、email、profile),不会读取你的 Gmail、云端硬盘、日历或通讯录。",
              "档案:你在「档案」页填写的内容——教育经历、工作与项目经历、简历内容、投递表单的标准答案(例如工作授权、可入职时间),以及只有在你主动选择保存时才会存下的自愿自我认定答案(性别、族裔、退伍军人与残障状况),用于填写申请表里的平等就业机会部分。你上传的文件(成绩单、求职信、作品集)会保存下来,以便助手在投递时附上。",
              "投递:你选中的岗位、助手填进表单的每一项内容、你的确认记录,以及你记录的结果。",
              "人脉:你添加或助手找到的人——姓名、职位、公司、LinkedIn 链接、对方公开展示的邮箱(如有)和简短备注,以及起草和发出的消息。",
              "技术信息:一个会话 cookie、一个语言 cookie、保存在你浏览器里的外观偏好,用于排查问题的服务器日志(请求来源地址、时间和网址),以及助手每一步操作的记录。",
            ],
            "岗位信息本身是从各公司招聘页面收集的公开信息,由这个实例的所有用户共用。",
          ],
        },
        {
          h: "2. 这些信息用来做什么",
          body: [
            "只用于为你运行 Sortie:把岗位和你的档案做匹配、起草消息、填写申请表、保存你的投递历史。没有广告,没有统计追踪器,你的数据不会被出售,也不会被用来训练任何模型。",
          ],
        },
        {
          h: "3. 谁还能看到",
          body: [
            [
              "你在设置里选择的 AI 提供方负责阅读、打分、起草和浏览器操作。选择 Codex 或 GPT API 时,相关数据会发送给 OpenAI;选择 Claude 时会发送给 Anthropic。内容包括档案中的相关经历、标准答案、岗位描述,以及填写申请表所需的联系方式和答案包。各提供方按其自身条款处理这些数据。",
              "雇主和招聘网站只有在你在 Sortie 里确认提交之后才会收到你的信息;没有你的确认,助手绝不提交。发给联系人的消息也只在你批准文字之后才会发出。",
              "Google,当你选择用 Google 登录时。",
              "基础设施:服务器位于运营者的 Tailscale 私有网络之后;如果运营者配置了邮件发送,验证邮件、重置密码邮件会经由该邮件服务商送达。",
            ],
            "除此之外没有其他人。运营者在技术上能够读取数据库,但除非为了处理你提出的问题,不会打开你的数据。",
          ],
        },
        {
          h: "4. 数据存放在哪里、如何保护",
          body: [
            "你的数据保存在运营者位于洛杉矶的一台服务器的数据库里,只能通过运营者的私有网络、经 HTTPS 访问。密码以哈希形式(scrypt)存储。登录会话 30 天后过期。每日备份保留 14 天。",
          ],
        },
        {
          h: "5. 你的选择与删除",
          body: [
            "「档案」页上的任何内容都可以随时修改或删除。「设置 → 账号」可以退出其他设备、撤销助手令牌、解除 Google 关联,以及删除账号。删除账号会立即移除你的档案、投递、人脉、消息和操作记录;备份副本会在 14 天内过期。你也可以写邮件给运营者索取数据副本或要求删除。",
          ],
        },
        {
          h: "6. 来自 Google 的信息",
          body: [
            "Sortie 对通过 Google API 获得的信息的使用遵守 Google API 服务用户数据政策(Google API Services User Data Policy),包括其中的「有限使用」(Limited Use)要求。Sortie 使用你的 Google 账号仅用于登录。",
          ],
        },
        {
          h: "7. Cookie",
          body: [
            "只有两个第一方 cookie:sortie.session_token(保持登录状态)和 sortie.lang(你选择的语言)。没有第三方 cookie。",
          ],
        },
        {
          h: "8. 未成年人",
          body: ["Sortie 面向成年求职者,不面向 18 岁以下的人。"],
        },
        {
          h: "9. 政策变更",
          body: ["页首的日期就是这份政策最近一次修改的时间。"],
        },
        {
          h: "10. 联系方式",
          body: ["关于隐私的任何问题或请求,写信给运营者:"],
        },
      ],
    },
    terms: {
      title: "服务条款",
      intro:
        "这些条款约束你对 Sortie(usesortie.com)的使用。Sortie 由 Mengjia Shang(下称「运营者」)作为个人非商业项目运营。创建账号或登录,即表示你同意这些条款。",
      sections: [
        {
          h: "1. Sortie 是什么",
          body: [
            "Sortie 是一个求职工具:它收集岗位信息、按你的档案打分、起草人脉消息,并由一个 AI 助手在你自己的浏览器里填写申请表。它免费提供,处于预览阶段,只开放给运营者邀请的一小圈人。",
          ],
        },
        {
          h: "2. 你的账号",
          body: [
            [
              "你需要年满 18 岁(或你所在地的成年年龄),使用真实姓名和一个可用的邮箱。",
              "你对账号下发生的一切负责;密码只能自己保管;每人只注册一个账号。",
            ],
          ],
        },
        {
          h: "3. 你的责任",
          body: [
            [
              "Sortie 替你写下的一切——档案、答案、草稿——都需要你自己核对。每份申请在确认前、每条消息在批准前,请先看一遍。投递的人是你,提交内容的准确性由你负责。",
              "不得用 Sortie 虚报你的资质、工作授权或身份,不得联系已经表示不想被联系的人,不得发送垃圾信息。",
              "Sortie 代你操作的网站(招聘网站、LinkedIn、雇主的申请系统)各有自己的条款,遵守它们是你的责任。Sortie 只在你自己已登录的浏览器里操作,从不输入你的密码,也不解验证码;请不要试图让它这么做。",
              "不得探测或干扰这项服务、其他用户的数据或运营者的网络。",
            ],
          ],
        },
        {
          h: "4. 助手的局限",
          body: [
            "AI 可能读错岗位、误判你的匹配度,或填错某一项。正因为如此,Sortie 会把填好的内容展示给你并等待你确认;它从不自行提交申请或发送消息。Sortie 不保证面试、offer 或任何结果。",
          ],
        },
        {
          h: "5. 你的内容",
          body: [
            "你放进 Sortie 的一切内容,权利仍归你所有。你授权运营者存储和处理这些内容,仅限于为你运行这项服务(见隐私政策)。Sortie 展示的岗位信息归各公司所有。",
          ],
        },
        {
          h: "6. 可用性与变更",
          body: [
            "Sortie 运行在一台机器上,随时可能停机、变慢或改变,恕不另行通知;功能可能增加或移除。运营者可以暂停或删除违反这些条款的账号,也可能关闭这项服务;在可能的情况下会通过邮件通知你。",
          ],
        },
        {
          h: "7. 免责声明与责任限制",
          body: [
            "Sortie 按「现状」提供,不附带任何形式的保证。在法律允许的最大范围内,运营者对你使用 Sortie 所造成的任何损失不承担责任——包括错过截止日期、申请被拒、消息发错人或数据丢失。凡不能排除的责任,以你为这项服务支付的金额为限,而这项服务是免费的。",
          ],
        },
        {
          h: "8. 终止",
          body: [
            "你可以随时在「设置 → 账号」里删除账号。删除后这些条款不再适用,但第 5、7、9 条继续有效。",
          ],
        },
        {
          h: "9. 适用法律",
          body: ["这些条款适用美国加利福尼亚州法律,不考虑其法律冲突规则。争议由加州洛杉矶县的法院管辖。"],
        },
        {
          h: "10. 条款变更",
          body: ["页首的日期就是这些条款最近一次修改的时间。条款修改后继续使用 Sortie,即表示你接受修改后的条款。"],
        },
        {
          h: "11. 联系方式",
          body: ["关于这些条款的任何问题,写信给运营者:"],
        },
      ],
    },
  },
  en: {
    updatedLabel: "Last updated",
    backToLogin: "Back to sign in",
    backToApp: "Back to Sortie",
    operatorLine: "Operated by Mengjia Shang (a personal project)",
    privacy: {
      title: "Privacy Policy",
      intro:
        "Sortie is a job-search assistant built and run by Mengjia Shang (the “operator”). It is a personal project offered to a small circle of people over a private network, not a commercial service. This page explains what Sortie stores about you, what it is used for, who can see it, and how to have it removed.",
      sections: [
        {
          h: "1. What Sortie stores",
          body: [
            [
              "Account: your name, email address and a hashed password, or, if you sign in with Google, the email, name and profile picture Google returns. Sortie asks Google only for the basic sign-in scopes (openid, email, profile); it never reads your Gmail, Drive, Calendar or Contacts.",
              "Profile: what you enter on the Profile page: education, work and project experience, résumé content, standard answers to application questions (for example work authorization and start date), and, only if you choose to save them, voluntary self-identification answers (gender, ethnicity, veteran and disability status) used to fill the equal-opportunity sections of application forms. Files you upload (transcripts, cover letters, portfolios) are kept so the assistant can attach them.",
              "Applications: which postings you chose, every field the assistant filled, your confirmations, and the outcomes you record.",
              "Networking: people you add or the assistant finds: name, title, company, LinkedIn URL, a public email address if one is shown, and short notes, plus the messages drafted and sent.",
              "Technical: a session cookie, a language cookie, an appearance preference kept in your browser, server logs used for troubleshooting (the address a request came from, its time and URL), and a step-by-step record of the assistant's work.",
            ],
            "Job postings themselves are public information collected from companies' career pages and are shared by every user of this instance.",
          ],
        },
        {
          h: "2. What it is used for",
          body: [
            "Only to run Sortie for you: matching postings against your profile, drafting messages, filling application forms and keeping your history. There is no advertising, no analytics tracker, and your data is never sold or used to train any model.",
          ],
        },
        {
          h: "3. Who else sees it",
          body: [
            [
              "The AI provider selected in Settings handles reading, scoring, drafting and browser work. With Codex or GPT API, the relevant data is sent to OpenAI; with Claude, it is sent to Anthropic. This includes relevant profile experience, standard answers, job postings, and the contact details and answer pack needed to fill an application. Each provider handles that data under its own terms.",
              "Employers and job boards receive your information only after you confirm a submission in Sortie; the assistant never submits without that confirmation. Messages to people you contact go out only after you approve the text.",
              "Google, when you choose to sign in with Google.",
              "Infrastructure: the server sits behind the operator's private Tailscale network; if the operator configures email sending, verification and password-reset mail is delivered through that mail provider.",
            ],
            "Nobody else. The operator can technically read the database, but will not open your data except to handle a problem you raise.",
          ],
        },
        {
          h: "4. Where it lives and how it is protected",
          body: [
            "Your data is kept in a database on a single server the operator runs in Los Angeles, reachable only through the operator's private network and over HTTPS. Passwords are stored hashed (scrypt). Sign-in sessions expire after 30 days. Daily backups are kept for 14 days.",
          ],
        },
        {
          h: "5. Your choices and deletion",
          body: [
            "Anything on the Profile page can be changed or removed at any time. Settings → Account lets you sign out other devices, revoke assistant tokens, unlink Google and delete your account. Deleting your account removes your profile, applications, people, messages and activity records immediately; backup copies expire within 14 days. You can also email the operator to request a copy of your data or its deletion.",
          ],
        },
        {
          h: "6. Information from Google",
          body: [
            "Sortie's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Sortie uses your Google account only to sign you in.",
          ],
        },
        {
          h: "7. Cookies",
          body: [
            "Two first-party cookies only: sortie.session_token (keeps you signed in) and sortie.lang (your chosen language). No third-party cookies.",
          ],
        },
        {
          h: "8. Minors",
          body: ["Sortie is for adult job seekers and is not directed at anyone under 18."],
        },
        {
          h: "9. Changes to this policy",
          body: ["The date at the top of this page is when this policy last changed."],
        },
        {
          h: "10. Contact",
          body: ["For any question or request about privacy, write to the operator:"],
        },
      ],
    },
    terms: {
      title: "Terms of Service",
      intro:
        "These terms govern your use of Sortie (usesortie.com), run by Mengjia Shang (the “operator”) as a personal, non-commercial project. By creating an account or signing in, you agree to them.",
      sections: [
        {
          h: "1. What Sortie is",
          body: [
            "Sortie is a job-search tool: it collects job postings, scores them against your profile, drafts networking messages, and has an AI assistant fill application forms in your own browser. It is offered free, as a preview, to a small circle of people the operator invites.",
          ],
        },
        {
          h: "2. Your account",
          body: [
            [
              "You must be at least 18 (or the age of majority where you live) and use your real name and a working email address.",
              "You are responsible for everything that happens under your account; keep your password to yourself; one account per person.",
            ],
          ],
        },
        {
          h: "3. Your responsibilities",
          body: [
            [
              "Everything Sortie writes on your behalf (your profile, answers and drafts) is yours to check. Read each application before you confirm it and each message before you approve it. You are the one applying, and the accuracy of what is submitted is your responsibility.",
              "Do not use Sortie to misrepresent your qualifications, work authorization or identity, to contact people who have asked not to be contacted, or to send spam.",
              "The sites Sortie operates on your behalf (job boards, LinkedIn, employers' application systems) have their own terms, and complying with them is your responsibility. Sortie works only in your own signed-in browser, never enters your passwords and never solves CAPTCHAs; do not try to make it.",
              "Do not probe or disrupt the service, other users' data or the operator's network.",
            ],
          ],
        },
        {
          h: "4. The assistant's limits",
          body: [
            "The AI can misread a posting, misjudge your fit, or fill a field wrong. That is exactly why Sortie shows you what it filled and waits for your confirmation; it never submits an application or sends a message on its own. Sortie does not guarantee interviews, offers or any outcome.",
          ],
        },
        {
          h: "5. Your content",
          body: [
            "You keep all rights to what you put into Sortie. You permit the operator to store and process it only to run the service for you (see the Privacy Policy). Job postings shown in Sortie belong to their respective companies.",
          ],
        },
        {
          h: "6. Availability and changes",
          body: [
            "Sortie runs on one machine and may be down, slow or changed at any time without notice; features may be added or removed. The operator may suspend or remove an account that breaks these terms, and may shut the service down; where possible you will be told by email.",
          ],
        },
        {
          h: "7. No warranty; limitation of liability",
          body: [
            "Sortie is provided “as is”, without warranties of any kind. To the fullest extent permitted by law, the operator is not liable for any loss arising from your use of Sortie, including a missed deadline, a rejected application, a message sent to the wrong person or lost data. Where liability cannot be excluded, it is limited to the amount you paid for the service, which is nothing.",
          ],
        },
        {
          h: "8. Termination",
          body: [
            "You can delete your account at any time under Settings → Account. These terms then stop applying, except sections 5, 7 and 9, which survive.",
          ],
        },
        {
          h: "9. Governing law",
          body: ["These terms are governed by the laws of the State of California, USA, without regard to its conflict-of-law rules. Disputes go to the courts of Los Angeles County, California."],
        },
        {
          h: "10. Changes to these terms",
          body: ["The date at the top of this page is when these terms last changed. Continuing to use Sortie after a change means you accept the changed terms."],
        },
        {
          h: "11. Contact",
          body: ["For any question about these terms, write to the operator:"],
        },
      ],
    },
  },
});
