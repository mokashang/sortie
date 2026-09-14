import { defineMessages } from "../define";

// Messages the server sends back to the browser as `error` / `message` (shown in a toast) and
// the few notes it writes on the user's behalf. Route handlers pick the language with
// langFromRequest(req); code without a request in hand falls back to the saved preference.
export const errors = defineMessages({
  zh: {
    referral_needs_attended: "找内推只能「在我的 Chrome 里」进行——后台浏览器只做海投。",
    scan_needs_attended: "扫描只能「在我的 Chrome 里」进行——LinkedIn、Handshake、Tesla 需要你已登录的浏览器。",
    applyRunBusy: "已有投递任务在跑,结束后请在卡片上再点一次「开始投」。",
    signInFirst: "登录后再试",
    ownerOnly: "只有这台机器的主账号可以改这个",
    profileIncomplete: "先在档案页填完基本信息,助手才能开始工作",
    signupDisabled: "这个 Sortie 实例已关闭注册",
    browserSessionRequired: "请在浏览器里登录后操作",
    tokenCreateInBrowser: "请在浏览器里登录后创建令牌",
    tokenRevokeInBrowser: "请在浏览器里登录后撤销令牌",
    defaultTokenName: "我的电脑",
    passwordTooShort: "密码至少 8 位。",
    passwordAlreadySet: "这个账号已经有密码了,用「修改密码」。",
    fileNotUploaded: (label: string) => `文件「${label}」还没上传`,
    profileInvalid: "有几项还不对",
    ownerOnlyImport: "只有主账号可以从服务器上的 profile.yaml 导入",
    fileMissing: (path: string) => `服务器上没有 ${path}`,
    selfSubmittedNote: "用户自己在网站上提交了这份申请",
  },
  en: {
    referral_needs_attended: "Finding referrals only works in your own Chrome — the background browser can only apply directly.",
    scan_needs_attended: "Scanning only works in your own Chrome — LinkedIn, Handshake and Tesla need your logged-in browser.",
    applyRunBusy: "An apply task is already running. Press Start applying on the card again once it finishes.",
    signInFirst: "Sign in and try again",
    ownerOnly: "Only this machine's owner account can change this",
    profileIncomplete: "Fill in the basics on your profile page before the assistant can start",
    signupDisabled: "This Sortie instance has closed sign-ups",
    browserSessionRequired: "Sign in in the browser to do this",
    tokenCreateInBrowser: "Sign in in the browser to create a token",
    tokenRevokeInBrowser: "Sign in in the browser to revoke a token",
    defaultTokenName: "My computer",
    passwordTooShort: "The password needs at least 8 characters.",
    passwordAlreadySet: "This account already has a password; use Change password.",
    fileNotUploaded: (label: string) => `The file "${label}" has not been uploaded yet`,
    profileInvalid: "A few fields are not right yet",
    ownerOnlyImport: "Only the owner account can import profile.yaml from the server",
    fileMissing: (path: string) => `${path} does not exist on the server`,
    selfSubmittedNote: "Submitted by the user directly on the site",
  },
});
