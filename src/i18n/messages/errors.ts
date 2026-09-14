import { defineMessages } from "../define";

// Messages the server sends back to the browser as `error` / `message` and the UI shows in a
// toast. Route handlers pick the language with langFromRequest(req).
export const errors = defineMessages({
  zh: {
    referral_needs_attended: "找内推只能「在我的 Chrome 里」进行——后台浏览器只做海投。",
    scan_needs_attended: "扫描只能「在我的 Chrome 里」进行——LinkedIn、Handshake、Tesla 需要你已登录的浏览器。",
    applyRunBusy: "已有投递任务在跑,结束后请在卡片上再点一次「开始投」。",
  },
  en: {
    referral_needs_attended: "Finding referrals only works in your own Chrome — the background browser can only apply directly.",
    scan_needs_attended: "Scanning only works in your own Chrome — LinkedIn, Handshake and Tesla need your logged-in browser.",
    applyRunBusy: "An apply task is already running. Press Start applying on the card again once it finishes.",
  },
});
