// Public magic-link page where a PM (or anyone they forward the link to) uploads
// screenshots for one project — no login. Rendered from the ADMIN projection
// server-side (the project may be an unpublished draft the public getProject
// would hide), but only { title, blurb } is handed to the client — never the
// admin-only students/teamId. The token in the URL is the capability.
import { getUploadRequest, getProjectAdmin } from "@/lib/db";
import UploadClient from "./UploadClient";

export const dynamic = "force-dynamic"; // never cache a per-token page

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f4f5f4",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 20px",
      }}
    >
      <header
        style={{
          width: "100%",
          maxWidth: 720,
          padding: "26px 4px 0",
          display: "flex",
          alignItems: "baseline",
          gap: 10,
        }}
      >
        <span style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 19 }}>
          BU Spark!
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "#8a8a8a",
            letterSpacing: "0.04em",
          }}
        >
          / project screenshots
        </span>
      </header>
      <main
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "20px 0 80px",
          background: "#fff",
          border: "1px solid #e6e6e6",
          borderRadius: 14,
          padding: "32px 34px",
        }}
      >
        {children}
      </main>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1
        style={{
          fontFamily: "var(--display)",
          fontSize: 24,
          color: "#16191c",
          margin: "0 0 10px",
        }}
      >
        {title}
      </h1>
      <p style={{ fontSize: 15, color: "#6a6f74", lineHeight: 1.55, margin: 0 }}>{body}</p>
    </>
  );
}

export default async function ContributePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const reqRow = await getUploadRequest(token);

  if (!reqRow) {
    return (
      <Shell>
        <Notice
          title="Link not found"
          body="This upload link is invalid. Ask your BU Spark! contact to send a new one."
        />
      </Shell>
    );
  }

  const expired =
    reqRow.status === "open" && new Date(reqRow.expiresAt).getTime() < Date.now();

  if (reqRow.status === "approved") {
    return (
      <Shell>
        <Notice
          title="All set — thank you!"
          body="These screenshots have already been reviewed and published. There's nothing more to do here."
        />
      </Shell>
    );
  }
  if (expired) {
    return (
      <Shell>
        <Notice
          title="This link has expired"
          body="Upload links are valid for 14 days. Ask your BU Spark! contact to send a fresh one."
        />
      </Shell>
    );
  }

  const project = await getProjectAdmin(reqRow.projectId);
  if (!project) {
    return (
      <Shell>
        <Notice
          title="Project unavailable"
          body="The project for this link no longer exists. Please contact BU Spark!."
        />
      </Shell>
    );
  }

  if (reqRow.status === "submitted") {
    return (
      <Shell>
        <Notice
          title="Submitted for review"
          body={`Thanks! Your screenshots for "${project.title}" are with the BU Spark! team for review. You'll see them on the project page once approved. You can close this tab.`}
        />
      </Shell>
    );
  }

  // status === 'open' and live → show the uploader. Pass ONLY public-safe fields.
  return (
    <Shell>
      <UploadClient
        token={token}
        projectTitle={project.title}
        projectBlurb={project.blurb}
        initialImages={reqRow.images}
        reviewNote={reqRow.reviewNote}
      />
    </Shell>
  );
}
