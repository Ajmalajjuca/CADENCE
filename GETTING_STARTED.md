# Getting started with Cadence

Never used Claude Code before? This is for you. Takes about 10 minutes total.

---

## Step 1 — Unzip the file

You downloaded `cadence.zip`.

- **Mac:** double-click it. A folder called `cadence` appears next to it.
- **Windows:** right-click it → "Extract All" → open the `cadence` folder that appears.

Move that `cadence` folder somewhere you'll find it again — your Desktop is fine.

---

## Step 2 — Install Claude Code

Cadence runs inside **Claude Code**, a free tool from Anthropic (the makers of Claude). You need this installed once.

1. Go to **[claude.com/claude-code](https://claude.com/claude-code)**
2. Download and install it for your computer (Mac, Windows, or Linux — all supported)
3. Open it and sign in with your Claude / Anthropic account (or create one — it's free to start)

---

## Step 3 — Open the Cadence folder

- Open the Claude Code app.
- When it asks for a project folder (or via a "Open Folder" / "Add Project" option), pick the **`cadence` folder** you unzipped in Step 1.
- You should see a chat box. That's it — you're in.

---

## Step 4 — Run the setup wizard

In the chat box, type exactly:

```
/setup
```

and press Enter. Cadence will introduce itself and ask you about 6 quick things — your name, your work, your audience, your voice (paste a couple of things you've written), your content pillars, and where posts should go when approved. Takes ~5 minutes. Just answer in plain English, like you're texting.

At the end it writes your personal profile — a set of files inside `knowledge_base/`. You now have your own trained version of Cadence.

---

## Step 5 — Make your first posts

Type:

```
/run-pipeline
```

Cadence will:
1. Find trending topics for you
2. Ask you to pick which ones to write
3. Show you hook options — pick your favorite for each
4. Write full drafts in your voice
5. Show you every post and ask you to approve, revise, or skip each one

**Nothing gets published without your yes at every step.** If a post isn't quite right, tell Cadence what to change — it learns from that.

---

## Where do my posts go?

Whatever you chose during `/setup`:
- **Notion** (easiest) — posts save to a Notion page, you copy-paste to LinkedIn yourself.
- **LinkedIn auto-publish** — needs a LinkedIn API key, see `README.md` → "Publishing options". Skip this at first.
- **Just show me** — posts just appear in the chat, you copy-paste.

You can change this anytime — just tell Cadence, or edit `knowledge_base/profile.md`.

---

## Stuck?

- **"I don't see a `/setup` command"** — make sure you opened the actual `cadence` folder (the one with a `.claude` folder inside it, even if it's hidden), not the zip file or a folder above/below it.
- **"Claude Code won't open the folder"** — check you finished Step 2 (installed and signed in) before Step 3.
- **Nothing happens after typing `/setup`** — make sure you pressed Enter, and that you're typing directly in the Claude Code chat box, not somewhere else.

Once it's running, see `README.md` for the full command list and publishing setup.
