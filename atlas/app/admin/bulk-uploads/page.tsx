// Was a 441-line standalone copy of a panel that already exists as the "Bulk
// outreach" tab of /admin/uploads — same endpoints, same fields, two places to
// maintain and two rail entries for one job.
//
// Kept as a redirect rather than deleted outright: the URL is in sent emails,
// bookmarks and at least one PM's notes, and a 404 there reads as "the feature
// was removed" rather than "it moved one tab over".
import { redirect } from "next/navigation";

export default function BulkUploadsPage() {
  redirect("/admin/uploads?tab=bulk");
}
