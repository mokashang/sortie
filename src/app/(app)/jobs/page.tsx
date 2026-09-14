import { redirect } from "next/navigation";

// /jobs was merged into /queue (the "职位" section: funnel counts + scan button + direction tabs
// + a "全部入库" tab that is the old raw listing). Kept only so old bookmarks still land somewhere.
export default function JobsPage() {
  redirect("/queue");
}
