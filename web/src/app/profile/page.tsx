import { linkButtonClass } from "../../components/ui";
import { ProfileEditor } from "../../features/profile/profile-editor";

export default function ProfilePage() {
  return <>
    <ProfileEditor />
    <section className="page-container pt-0">
      <div className="surface-card p-6 sm:p-8">
        <p className="eyebrow">Account data</p>
        <h2 className="mt-2 text-2xl font-semibold">Export your data</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">Download your profile, ideas, drafts, approvals, and publication history. Connection tokens are never included.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/api/export?format=json" className={linkButtonClass.secondary}>Download JSON</a>
          <a href="/api/export?format=markdown" className={linkButtonClass.secondary}>Download Markdown</a>
        </div>
      </div>
    </section>
  </>;
}
