import { RunProgress } from "../../../features/create/run-progress";
export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; return <RunProgress runId={runId} />; }
