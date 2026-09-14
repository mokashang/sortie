"use client";
import { Search, UserPlus } from "lucide-react";
import { labelOf } from "@/app/lib/labels";
import { cx } from "@/app/lib/cx";
import { Button, Chip, EmptyState, Input, Select } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
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
  const m = useMessages();
  return (
    <div className="contacts-pane">
      <div className="row mb-2">
        <div className="input-icon grow">
          <Search size={14} aria-hidden />
          <Input small placeholder={m.network.contacts.searchPlaceholder} aria-label={m.network.contacts.searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select small aria-label={m.network.contacts.relationFilter} value={relation} onChange={(e) => setRelation(e.target.value)} style={{ width: "auto" }}>
          <option value="">{m.network.contacts.allRelations}</option>
          {RELATIONS.map((r) => (
            <option key={r} value={r}>
              {m.labels.relation[r]}
            </option>
          ))}
        </Select>
        <Button size="sm" icon={<UserPlus size={13} />} onClick={onAdd}>
          {m.common.add}
        </Button>
      </div>
      {total === 0 ? (
        <EmptyState compact art="people" title={m.network.contacts.empty} description={m.network.contacts.emptyDescription} />
      ) : people.length === 0 ? (
        <EmptyState compact title={m.network.contacts.noMatch} />
      ) : (
        <div className="contact-list" role="listbox" aria-label={m.network.contacts.title}>
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
                {p.relation ? <Chip outline>{labelOf(m.labels.relation, p.relation, p.relation)}</Chip> : null}
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
