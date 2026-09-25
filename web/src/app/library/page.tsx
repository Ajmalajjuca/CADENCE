import { LibraryList } from "../../features/library/library-list";
export default function LibraryPage() {
  return <main className="page-container">
    <header className="page-heading">
      <p className="eyebrow">Library</p>
      <h1 className="display-heading">Your content, in one place</h1>
      <p className="page-intro">Your ideas, drafts, approvals, and published posts—ready when you are.</p>
    </header>
    <LibraryList />
  </main>;
}
