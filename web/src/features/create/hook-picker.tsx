import { Button } from "../../components/ui";

type Hook = { id: string; type: string; text: string; sourceUrl: string | null };

export function HookPicker({ hooks, onChoose, busy }: { hooks: Hook[]; onChoose: (id: string) => void; busy: boolean }) {
  return <section aria-labelledby="hooks-heading" className="mt-8">
    <p className="eyebrow">Opening lines</p>
    <h2 id="hooks-heading" className="mt-2 text-3xl font-semibold">Hooks for your post</h2>
    <div className="mt-5 grid gap-4">
      {hooks.map((hook) => <article key={hook.id} className="surface-card p-6">
        <p className="eyebrow">{hook.type}</p>
        <p className="mt-3 whitespace-pre-wrap text-xl font-semibold leading-8">{hook.text}</p>
        {hook.sourceUrl && <a href={hook.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold underline underline-offset-4">View source</a>}
        <Button disabled={busy} onClick={() => onChoose(hook.id)} className="mt-5 block">Use this hook</Button>
      </article>)}
    </div>
  </section>;
}
