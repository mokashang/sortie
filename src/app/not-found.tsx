import { EmptyState, LinkButton } from "@/app/components/ui";
import { getMessages } from "@/i18n/server";

export default async function NotFound() {
  const m = await getMessages();
  return (
    <EmptyState
      art="compass"
      title={m.ui.notFoundTitle}
      description={m.ui.notFoundDescription}
      action={
        <LinkButton href="/" variant="primary">
          {m.ui.backHome}
        </LinkButton>
      }
    />
  );
}
