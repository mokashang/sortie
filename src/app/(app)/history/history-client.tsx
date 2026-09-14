"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { POST_SUBMIT_STAGES, STAGE_LABELS, type HistoryRow, type PostSubmitStage } from "@/apply/stages";
import { postJson, errorMessage } from "@/app/lib/api";
import { Chip, EmptyState, LinkButton, PromptDialog, Section, Segmented, Stat, StatStrip, Tabs, useToast } from "@/app/components/ui";
import { HistorySankey } from "./history-sankey";
import { StageMenu, stageTone } from "./stage-menu";

const ALL = "__all__";
type ModeFilter = "all" | "referral" | "direct";

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function HistoryClient({ rows: initial }: { rows: HistoryRow[] }) {
  const [rows, setRows] = useState(initial);
  const [direction, setDirection] = useState<string>(ALL);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [pending, setPending] = useState<{ row: HistoryRow; stage: PostSubmitStage } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const tabs = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const r of rows) counts.set(r.direction, (counts.get(r.direction) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return b[1] - a[1];
    });
  }, [rows]);

  const visible = rows.filter((r) => (direction === ALL || (r.direction ?? "") === direction) && (mode === "all" || r.applyMode === mode));
  const modeCounts = {
    all: rows.length,
    referral: rows.filter((r) => r.applyMode === "referral").length,
    direct: rows.filter((r) => r.applyMode === "direct").length,
  };

  const stageCounts = useMemo(() => {
    const m = new Map<PostSubmitStage, number>();
    for (const r of visible) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return m;
  }, [visible]);

  const days = useMemo(() => {
    const groups: { day: string; rows: HistoryRow[] }[] = [];
    for (const r of visible) {
      const last = groups[groups.length - 1];
      if (last && last.day === r.submittedDay) last.rows.push(r);
      else groups.push({ day: r.submittedDay, rows: [r] });
    }
    return groups;
  }, [visible]);

  async function changeStage(row: HistoryRow, stage: PostSubmitStage, note: string) {
    setBusyId(row.jobId);
    try {
      await postJson("/api/apply/stage", { jobId: row.jobId, stage, note: note || undefined });
      setRows((prev) => prev.map((r) => (r.jobId === row.jobId ? { ...r, status: stage, updatedAt: nowLocal(), lastNote: note || r.lastNote } : r)));
      toast({ title: `${row.company} → ${STAGE_LABELS[stage]}`, tone: "good" });
      setPending(null);
      router.refresh();
    } catch (e) {
      toast({ title: "更新失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<History size={26} />}
        title="还没有投出去的申请"
        description="在投递页确认提交后,申请会记到这里,之后的 OA、面试、Offer 也在这里更新。"
        action={<LinkButton href="/apply">去投递</LinkButton>}
      />
    );
  }

  return (
    <div>
      <StatStrip compact>
        {POST_SUBMIT_STAGES.filter((s) => (stageCounts.get(s) ?? 0) > 0 || s === "submitted").map((s) => (
          <Stat key={s} label={STAGE_LABELS[s]} value={stageCounts.get(s) ?? 0} tone={stageTone(s) === "warn" ? "warn" : stageTone(s) === "good" ? "good" : undefined} />
        ))}
      </StatStrip>

      <HistorySankey rows={visible} />

      <Tabs
        ariaLabel="方向"
        value={direction}
        onChange={setDirection}
        items={[{ key: ALL, label: "全部", count: rows.length }, ...tabs.map(([dir, n]) => ({ key: dir ?? "", label: dir ? directionLabel(dir) : "未分类", count: n }))]}
      />
      <div className="row mb-4">
        <Segmented<ModeFilter>
          ariaLabel="投递方式"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "all", label: "全部", count: modeCounts.all },
            { value: "referral", label: "内推", count: modeCounts.referral },
            { value: "direct", label: "海投", count: modeCounts.direct },
          ]}
        />
      </div>

      {days.length === 0 ? (
        <EmptyState compact title="这个筛选下没有申请" />
      ) : (
        days.map((g) => (
          <Section key={g.day} title={g.day} count={g.rows.length}>
            <div className="history-list">
              {g.rows.map((r) => (
                <div key={r.jobId} className="history-row">
                  <span className="mono muted small history-time">{r.submittedAt.slice(11)}</span>
                  <div className="history-main">
                    <div className="row">
                      <span className="serif strong">{r.company}</span>
                      {r.applyUrl ? (
                        <a href={r.applyUrl} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        <span>{r.title}</span>
                      )}
                    </div>
                    <div className="row mt-1">
                      <Chip outline>{r.direction ? directionLabel(r.direction) : "未分类"}</Chip>
                      {r.applyMode === "referral" ? <Chip tone="good">内推{r.referralPersonName ? ` · ${r.referralPersonName}` : ""}</Chip> : <Chip>海投</Chip>}
                      {r.resumeVersion ? <span className="muted xs mono">简历 {r.resumeVersion}</span> : null}
                      {r.lastNote ? (
                        <span className="muted small truncate" style={{ maxWidth: 360 }} title={r.lastNote}>
                          {r.lastNote}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="history-side">
                    <StageMenu value={r.status} busy={busyId === r.jobId} onChange={(stage) => setPending({ row: r, stage })} />
                    <span className="muted xs mono nowrap" title="最后更新">
                      {r.updatedAt.slice(5)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ))
      )}

      <PromptDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onSubmit={(note) => {
          if (pending) void changeStage(pending.row, pending.stage, note);
        }}
        busy={pending !== null && busyId === pending.row.jobId}
        title={pending ? `${pending.row.company} → ${STAGE_LABELS[pending.stage]}` : ""}
        description="可以顺手记一条备注,比如 OA 截止日或面试官。"
        label="备注"
        placeholder="例如:OA 截止 9/15 · 面试官 Alex"
        submitLabel="更新状态"
        multiline
      />
    </div>
  );
}
