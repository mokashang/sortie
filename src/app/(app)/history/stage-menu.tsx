"use client";
import { ChevronDown } from "lucide-react";
import { POST_SUBMIT_STAGES, stageLabels, type PostSubmitStage } from "@/apply/stages";
import type { Tone } from "@/app/lib/labels";
import { cx } from "@/app/lib/cx";
import { Menu } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";

export function stageTone(stage: PostSubmitStage): Tone {
  switch (stage) {
    case "offer":
    case "offer_accepted":
      return "warn";
    case "oa":
    case "interview":
      return "good";
    case "submitted":
      return "info";
    default:
      return "neutral";
  }
}

// The per-row status control on 历史: a chip that opens the list of stages.
export function StageMenu({ value, busy, onChange }: { value: PostSubmitStage; busy: boolean; onChange: (stage: PostSubmitStage) => void }) {
  const m = useMessages();
  const lang = useLang();
  const STAGE = stageLabels(lang);
  return (
    <Menu
      label={m.history.stage.changeStatus}
      align="start"
      disabled={busy}
      trigger={(p) => (
        <button type="button" className={cx("chip", "chip-md", `chip-${stageTone(value)}`, "stage-trigger")} {...p}>
          {STAGE[value]}
          <ChevronDown size={12} aria-hidden />
        </button>
      )}
      items={POST_SUBMIT_STAGES.map((s) => ({ label: STAGE[s], onSelect: () => onChange(s), disabled: s === value }))}
    />
  );
}
