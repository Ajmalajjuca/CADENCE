import { DraftEditor } from "../../../features/drafts/editor";
export default async function PostPage({ params }: { params: Promise<{ draftId: string }> }) { const { draftId } = await params; return <DraftEditor draftId={draftId} />; }
