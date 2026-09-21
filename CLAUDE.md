# Cadence

A multi-agent LinkedIn content pipeline that runs inside Claude Code. It researches topics, drafts posts in the user's voice, manages approvals, optionally publishes to LinkedIn, and logs to Notion. No Anthropic API key required — Claude Code is the model.

**Never publish a post without explicit approval at the approval checkpoint. Never overwrite the user's knowledge base without telling them.**

---

## Who this is for

The user — defined by them during `/setup`. Their identity, audience, goals, content pillars, voice, and story bank all live in `knowledge_base/profile.md` and `knowledge_base/writing_samples.md`. Read those first; they are the source of truth for who this is and how they sound. If the knowledge base is still a template, the user hasn't run `/setup` yet — point them to it.

---

## How to run

**First time:**
```
/setup
```
Interviews the user and writes their knowledge base. Must run before the pipeline produces good output.

**Create content:**
```
/run-pipeline
/run-pipeline --niche "..." --ideas "topic 1\ntopic 2"
```

**Feed a strong post back into voice training:**
```
/add-writing-sample
```

**Periodic strategy review:**
```
/linkedin-manager
```

**Publishing (optional):**
```
pip install -r requirements.txt
python scripts/publish_post.py --dry-run --topic "TITLE" --text "POST TEXT"
```

---

## Architecture

```
/setup             →  Onboarding wizard (writes the knowledge base)
/linkedin-manager  →  Strategy layer (periodic review)
/run-pipeline      →  Orchestrator (spawns agents, runs each session)
.claude/agents/    →  8 sub-agents (isolated workers, own context windows)
```

**The agents:** researcher · topic-ranker · topic-deep-researcher · hook-factory · content-writer · style-editor · strategy-analyzer (coordinated by the orchestrator).

**Why sub-agents:** each has an isolated context window. Only the result returns to the orchestrator — not the search noise. Keeps the orchestrator lean across a full run.

---

## Key files

**Commands (the user types these):**
- `.claude/commands/setup.md` — onboarding wizard
- `.claude/commands/run-pipeline.md` — main orchestrator
- `.claude/commands/add-writing-sample.md` — add a post to voice samples
- `.claude/commands/linkedin-manager.md` — strategy + analytics review

**Knowledge base (read before writing any post; the user owns these):**
- `knowledge_base/profile.md` — identity, audience, pillars, story bank
- `knowledge_base/content_rules.md` — post format rules (treat as law)
- `knowledge_base/writing_samples.md` — the user's raw voice
- `knowledge_base/high_performing_posts.md` — structural patterns to study
- `knowledge_base/strategy_log.md` — running session history

---

## Golden rules

1. **Approval is sacred.** Nothing publishes without the user saying yes at the approval checkpoint.
2. **The voice is theirs.** Calibrate to `writing_samples.md` + `profile.md`. Never corporate-ify it.
3. **The user controls learning.** Propose KB changes; apply only what they approve.
4. **Opinion over information.** Every post needs a held view, not a summary.
