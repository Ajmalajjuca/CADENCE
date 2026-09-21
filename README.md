# Cadence

*Your personal LinkedIn ghostwriter — a team of AI agents that writes in your voice, inside Claude Code.*

A team of AI agents that researches topics, writes LinkedIn posts **in your voice**, and waits for your approval before anything ships. Runs entirely inside Claude Code — no API keys required to start.

It's not one bot. It's 8 specialists — a researcher, a topic ranker, a hook writer, a content writer, a style editor, a strategist — coordinated by an orchestrator, with you in control at every checkpoint.

---

**First time with Claude Code?** Read [`GETTING_STARTED.md`](./GETTING_STARTED.md) instead — it walks through installing Claude Code and unzipping this folder, step by step.

## Start in 3 steps (~5 minutes)

1. **Open this folder in [Claude Code](https://claude.com/claude-code).**
   (Install it first if you haven't — then open this folder as the project.)

2. **Type `/setup`.**
   The wizard interviews you — who you are, your audience, your pillars, your voice (paste a few things you've written). It writes your personal knowledge base from your answers. ~5 min.

3. **Type `/run-pipeline`.**
   The agents find this week's topics and draft posts in your voice. It **pauses at every checkpoint** — you pick topics, pick hooks, approve posts. Nothing publishes without you.

That's it.

---

## What you can do

| Command | What it does |
|---|---|
| `/setup` | One-time onboarding — trains the system on you |
| `/run-pipeline` | Create this week's posts (the main loop) |
| `/add-writing-sample` | Feed a great post back in so it keeps learning your voice |
| `/linkedin-manager` | Periodic strategy review of your content + analytics |

---

## Publishing options

When a post is approved, you choose where it goes (set during `/setup`, changeable anytime):

- **Notion** — saves to a Notion page, you post manually. Easiest, safest. *(default)*
- **LinkedIn auto-publish** — posts directly. Add your token to `.env` (see `.env.example`). Until then it runs in **dry-run** — drafts everything, posts nothing.
- **Show me** — drafts stay here, you copy-paste.

To enable LinkedIn publishing later:
```bash
pip install -r requirements.txt
cp .env.example .env   # then add your LinkedIn token + URN
```

---

## It learns you

Every run gets sharper:
- After approving posts, you choose **what the system should remember** (a revision you made, a word you hate). It saves to your rules.
- After any post that lands, run `/add-writing-sample`.
- Edit anything in `knowledge_base/` whenever you want.

First few runs won't be perfect. Tell it what to change at the approval step — that's the whole point.

---

## What's inside

```
.claude/commands/   the things you type (/setup, /run-pipeline, ...)
.claude/agents/     the 8 specialists (run automatically)
knowledge_base/     YOU — your profile, voice, rules, inspiration (the wizard fills this)
scripts/ + integrations/   optional LinkedIn publishing
```

Your knowledge base is yours. It never leaves your machine.
