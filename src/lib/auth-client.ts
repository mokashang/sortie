"use client";
import { createAuthClient } from "better-auth/react";

// The browser-side Better Auth client (same origin: /api/auth/*). Pages import this for sign-in,
// sign-up, password reset, session hooks and the account section on 设置.
export const authClient = createAuthClient();

export type SessionData = ReturnType<typeof authClient.useSession>["data"];

// Better Auth returns {error: {code, message}} rather than throwing; map its codes to the
// Chinese copy the forms show.
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不对。",
  USER_ALREADY_EXISTS: "这个邮箱已经注册过了,直接登录或找回密码。",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "这个邮箱已经注册过了,直接登录或找回密码。",
  EMAIL_NOT_VERIFIED: "邮箱还没验证。去收件箱点验证链接,或在下面重发一封。",
  INVALID_PASSWORD: "密码不对。",
  PASSWORD_TOO_SHORT: "密码至少 8 位。",
  PASSWORD_TOO_LONG: "密码太长了。",
  INVALID_TOKEN: "链接已失效或已经用过,请重新申请一封。",
  TOKEN_EXPIRED: "链接已过期,请重新申请一封。",
  USER_NOT_FOUND: "没有这个账号。",
  SESSION_EXPIRED: "登录已过期,请重新登录。",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "这个账号没有设置过密码,先在下面设置一个。",
  EMAIL_CAN_NOT_BE_UPDATED: "这个邮箱不能修改。",
  SOCIAL_ACCOUNT_ALREADY_LINKED: "这个 Google 账号已经关联到别的 Sortie 账号了。",
  signup_disabled: "这个 Sortie 实例已关闭注册。",
  FAILED_TO_CREATE_USER: "创建账号失败,请稍后再试。",
};

export function authErrorMessage(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  if (!err) return "出错了,请重试。";
  if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
  if (err.status === 429) return "试得太频繁了,歇一分钟再来。";
  return err.message || "出错了,请重试。";
}
