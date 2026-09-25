type Brief = {
  topic: string;
  angle: string;
  facts: Array<{ text: string; sourceUrl: string }>;
  sources: Array<{ url: string; title: string; note: string }>;
};

export function ResearchPanel({ brief }: { brief: Brief }) {
  return <section className="surface-card mt-6 p-6" aria-labelledby="research-heading">
    <p className="eyebrow">Saved progress</p>
    <h2 id="research-heading" className="mt-2 text-2xl font-semibold">Research</h2>
    <p className="mt-2 leading-7 text-[var(--muted)]">{brief.angle}</p>
    {brief.facts.length
      ? <ul className="mt-5 space-y-3">{brief.facts.map((fact, index) => <li key={index} className="leading-7">
          {fact.text} <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">Source</a>
        </li>)}</ul>
      : <p className="mt-4 text-sm text-[var(--muted)]">No verified factual claims found. This post will be framed as an opinion.</p>}
    {brief.sources.length > 0 && <div className="mt-5 border-t border-[var(--border)] pt-4">
      <h3 className="text-lg font-semibold">Sources</h3>
      <ul className="mt-2 list-inside list-disc space-y-2">
        {brief.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-4">{source.title || source.url}</a></li>)}
      </ul>
    </div>}
  </section>;
}
