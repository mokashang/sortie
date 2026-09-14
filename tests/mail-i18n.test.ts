import { describe, it, expect } from "vitest";
import { verificationMail, resetPasswordMail, changeEmailMail, deleteAccountMail } from "@/lib/mailer";

const CJK = /[㐀-鿿]/;
const URL = "https://usesortie.com/api/auth/verify-email?token=abc123";

describe("account mails follow the language", () => {
  it("chinese templates carry the link in text and html", () => {
    const m = verificationMail("me@example.com", "Mengjia", URL, "zh");
    expect(m.subject).toBe("验证你的 Sortie 邮箱");
    expect(m.text.startsWith("Mengjia,")).toBe(true);
    expect(m.text).toContain(URL);
    expect(m.html).toContain(URL);
    expect(m.html).toContain('lang="zh-CN"');
    expect(resetPasswordMail("me@example.com", "", URL, "zh").text.startsWith("你好,")).toBe(true);
    expect(changeEmailMail("me@example.com", "Mengjia", "new@example.com", URL, "zh").text).toContain("new@example.com");
  });

  it("english templates contain no chinese and still carry the link", () => {
    const mails = [
      verificationMail("me@example.com", "Mengjia", URL, "en"),
      resetPasswordMail("me@example.com", "", URL, "en"),
      changeEmailMail("me@example.com", "Mengjia", "new@example.com", URL, "en"),
      deleteAccountMail("me@example.com", "Mengjia", URL, "en"),
    ];
    for (const m of mails) {
      expect(m.subject).not.toMatch(CJK);
      expect(m.text).not.toMatch(CJK);
      expect(m.html ?? "").not.toMatch(CJK);
      expect(m.text).toContain(URL);
      expect(m.html).toContain(URL);
      expect(m.html).toContain('lang="en"');
    }
    expect(mails[0].subject).toBe("Verify your Sortie email");
    expect(mails[1].text.startsWith("Hi there,")).toBe(true);
    expect(mails[2].text).toContain("new@example.com");
  });
});
