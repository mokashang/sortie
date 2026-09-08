import { redirect } from "next/navigation";

// Resume Studio merged into 档案's 简历 tab. Kept so old bookmarks still land somewhere.
export default function StudioPage() {
  redirect("/profile?tab=resumes");
}
