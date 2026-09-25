import { Button } from "../../components/ui";

type Idea = { id: string; title: string; angle: string; whyNow: string; pillar: string; sourceUrls: string[] };

export function IdeaPicker({ ideas, onChoose, busy }: { ideas: Idea[]; onChoose: (id: string) => void; busy: boolean }) {
  return <section aria-labelledby="ideas-heading" className="mt-8">
    <div className="max-w-2xl">
      <p className="eyebrow">Your options</p>
      <h2 id="ideas-heading" className="mt-2 text-3xl font-semibold">Ideas for your post</h2>
      <p className="mt-2 text-[var(--muted)]">Choose the direction with the most energy. Cadence will keep the rest of the journey moving.</p>
    </div>
    <div className="mt-5 grid gap-4">
      {ideas.map((idea) => <article key={idea.id} className="surface-card p-6">
        <p className="eyebrow">{idea.pillar || "Idea"}</p>
        <h3 className="mt-2 text-2xl font-semibold">{idea.title}</h3>
        <p className="mt-2 leading-7 text-[var(--muted)]">{idea.angle}</p>
        {idea.whyNow && <p className="mt-3 text-sm text-[var(--muted)]"><strong className="text-[var(--ink)]">Why now:</strong> {idea.whyNow}</p>}
        {idea.sourceUrls.length > 0 && <div className="mt-3 flex flex-wrap gap-3">
          {idea.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline underline-offset-4">Source {index + 1}</a>)}
        </div>}
        <Button disabled={busy} onClick={() => onChoose(idea.id)} className="mt-5">Choose this idea</Button>
      </article>)}
    </div>
  </section>;
}
