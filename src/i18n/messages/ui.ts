import { defineMessages } from "../define";

// Copy baked into the component library (src/app/components/ui/*): dialog buttons, the drawer
// close button, stepper controls, toast dismiss, skeleton busy label.
export const ui = defineMessages({
  zh: {
    close: "关闭",
    cancel: "取消",
    confirm: "确认",
    submit: "提交",
    optional: "可留空",
    more: "更多",
    loading: "加载中",
    dismiss: "关闭提示",
    stepperMinus: (label: string) => `${label} 减一`,
    stepperPlus: (label: string) => `${label} 加一`,
    errorTitle: "出了点问题",
    errorFallback: "页面渲染失败。",
    retry: "重试",
    notFoundTitle: "页面不存在",
    notFoundDescription: "这个地址没有对应的页面。",
    backHome: "回到今日",
  },
  en: {
    close: "Close",
    cancel: "Cancel",
    confirm: "Confirm",
    submit: "Submit",
    optional: "Optional",
    more: "More",
    loading: "Loading",
    dismiss: "Dismiss",
    stepperMinus: (label: string) => `${label}: one less`,
    stepperPlus: (label: string) => `${label}: one more`,
    errorTitle: "Something went wrong",
    errorFallback: "The page failed to render.",
    retry: "Retry",
    notFoundTitle: "Page not found",
    notFoundDescription: "Nothing lives at this address.",
    backHome: "Back to Today",
  },
});
