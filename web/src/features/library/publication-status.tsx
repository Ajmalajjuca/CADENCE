export function PublicationStatus({ status }: { status: string }) {
  const labels: Record<string,string> = { pending: "Publishing", published: "Published", failed: "Publish failed", uncertain: "Needs review" };
  const colors: Record<string,string> = { pending: "bg-amber-100 text-amber-900", published: "bg-green-100 text-green-900", failed: "bg-red-100 text-red-900", uncertain: "bg-amber-100 text-amber-900" };
  return <span className={`rounded-full px-3 py-1 text-xs ${colors[status] ?? "bg-slate-100 text-slate-700"}`}>{labels[status] ?? status}</span>;
}
