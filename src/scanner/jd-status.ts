// jobs.jd_status 的插入时判定:ATS 自带正文 → NULL;空串或 github_lists 的
// "[listing metadata] ..." 标记 → 'missing'(待 jd_review 执行器补正文)。
export function jdStatusFor(jdText: string | null | undefined): "missing" | null {
  if (!jdText || jdText.startsWith("[listing metadata]")) return "missing";
  return null;
}
