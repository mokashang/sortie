import { Info } from "lucide-react";

export interface TooltipProps {
  content: string;
  children?: React.ReactNode;
}

// Hover/focus tooltip driven purely by CSS (attr(data-tip)). Wrap an element, or leave children
// empty for a small ⓘ marker.
export function Tooltip({ content, children }: TooltipProps) {
  return (
    <span className="tip" data-tip={content} tabIndex={0} aria-label={content} role="note">
      {children ?? <Info size={13} className="tip-icon" aria-hidden />}
    </span>
  );
}
