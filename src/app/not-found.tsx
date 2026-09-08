import { Compass } from "lucide-react";
import { EmptyState, LinkButton } from "@/app/components/ui";

export default function NotFound() {
  return (
    <EmptyState
      icon={<Compass size={28} />}
      title="页面不存在"
      description="这个地址没有对应的页面。"
      action={
        <LinkButton href="/" variant="primary">
          回到今日
        </LinkButton>
      }
    />
  );
}
