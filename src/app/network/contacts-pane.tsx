"use client";
import { Search, UserPlus } from "lucide-react";
import { RELATION_LABEL, labelOf } from "@/app/lib/labels";
import { cx } from "@/app/lib/cx";
import { Button, Chip, EmptyState, Input, Select } from "@/app/components/ui";
import { RELATIONS, type Person } from "./network-types";

export interface ContactsPaneProps {
  people: Person[];
  total: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
  query: string;
  setQuery: (q: string) => void;
  relation: string;
  setRelation: (r: string) => void;
}

export function ContactsPane({ people, total, selectedId, onSelect, onAdd, query, setQuery, relation, setRelation }: ContactsPaneProps) {
  return (
    <div className="contacts-pane">
      <div className="row mb-2">
        <div className="input-icon grow">
          <Search size={14} aria-hidden />
          <Input small placeholder="搜姓名或公司" aria-label="搜索联系人" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select small aria-label="关系" value={relation} onChange={(e) => setRelation(e.target.value)} style={{ width: "auto" }}>
          <option value="">全部关系</option>
          {RELATIONS.map((r) => (
            <option key={r} value={r}>
              {RELATION_LABEL[r]}
            </option>
          ))}
        </Select>
        <Button size="sm" icon={<UserPlus size={13} />} onClick={onAdd}>
          添加
        </Button>
      </div>
      {total === 0 ? (
        <EmptyState compact art="people" title="还没有联系人" description="手动添加,或让助手去队列头部的公司找人。" />
      ) : people.length === 0 ? (
        <EmptyState compact title="没有匹配的联系人" />
      ) : (
        <div className="contact-list" role="listbox" aria-label="联系人">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === selectedId}
              className={cx("contact-item", p.id === selectedId && "is-active")}
              onClick={() => onSelect(p.id)}
            >
              <div className="row between row-nowrap">
                <span className="serif strong truncate">{p.name}</span>
                {p.relation ? <Chip outline>{labelOf(RELATION_LABEL, p.relation, p.relation)}</Chip> : null}
              </div>
              <div className="muted small truncate">
                {[p.company, p.role_title].filter(Boolean).join(" · ") || "—"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
