<script lang="ts">
import BlogPostLayout from "$lib/blog/blog-post-layout.svelte";
import { checkpointsBlogPost as metadata } from "$lib/blog/posts.js";
import { MarkdownDisplay } from "@acepe/ui";
import CheckpointFullDemo from "$lib/blog/demos/checkpoint-full-demo.svelte";
import CheckpointCardDemo from "$lib/blog/demos/checkpoint-card-demo.svelte";
import CheckpointRevertDemo from "$lib/blog/demos/checkpoint-revert-demo.svelte";

let { data } = $props();
</script>

<BlogPostLayout
		{metadata}
		showDownload={data.featureFlags.downloadEnabled}
		showLogin={data.featureFlags.loginEnabled}
	>
	<MarkdownDisplay
		content={`
# What are Checkpoints?

When working with AI agents that modify your code, you need safety rails. Acepe's checkpoint system automatically creates point-in-time snapshots of file changes, letting you revert mistakes, track history, and experiment fearlessly.

Unlike Git commits, checkpoints work at the **file level**. You can revert individual files without affecting others, giving you surgical control over changes made during an agent session.

## How Checkpoints Work

Every time an AI agent uses a file editing tool (Read, Edit, Write), Acepe creates an automatic checkpoint. These snapshots are:

- **Lightweight** - Content-deduplicated using SHA-256 hashes
- **Automatic** - Created on every file modification
- **Granular** - File-level, not repository-level
- **Linked** - Connected to specific tool calls for context
- **Fast** - Instant revert without Git operations

Here's what a checkpoint timeline looks like in action:
	`}
	/>

	<CheckpointFullDemo />

	<MarkdownDisplay
		content={`
## Checkpoint Anatomy

Each checkpoint card displays essential information at a glance:
	`}
	/>

	<CheckpointCardDemo />

	<MarkdownDisplay
		content={`
The compact design shows:
- Checkpoint number and user message context
- Timestamp and file count
- Total diff stats (insertions/deletions)
- Expandable file list with per-file changes

## File-Level Granularity

Made a mistake 5 checkpoints ago? Revert just that one file to its previous state while keeping other improvements. This is like Git bisect but instant and visual.

Each checkpoint shows:
- Which files changed
- Lines added/removed per file
- Total diff stats across all files
- Timestamp and context from the agent's message

## Reverting Changes

Reverting is a single click with confirmation to prevent accidents:
	`}
	/>

	<CheckpointRevertDemo />

	<MarkdownDisplay
		content={`
The revert process is:
1. Click "Revert this file" on any checkpoint
2. Confirm the action (prevents accidental reverts)
3. File instantly restored to that checkpoint's state
4. Other files remain unchanged

This gives you surgical control over your codebase during agent sessions.

## When Checkpoints Save You

- **Agent made a wrong turn** - Revert the broken file, keep the rest
- **Debugging regressions** - Revert to a known-good state instantly
- **Experimenting freely** - Let the agent try approaches without fear
- **Reviewing changes** - See exactly what changed at each step
- **Partial rollbacks** - Undo one file while keeping improvements in others

## Time-Travel Debugging

Checkpoints enable time-travel debugging for AI agent sessions:

1. Agent makes changes across multiple files
2. You notice one change broke something
3. Open checkpoint timeline to see file history
4. Identify the problematic change
5. Revert just that file, keep everything else
6. Continue working from stable state

All without touching Git, opening diffs, or losing your flow.

## Why Not Just Use Git?

Checkpoints complement Git, they don't replace it:

| Git | Checkpoints |
|-----|-------------|
| Repository-level commits | File-level snapshots |
| Manual commit workflow | Automatic on every edit |
| Requires commit messages | Auto-generated from context |
| Full version control | Session-scoped safety net |
| Permanent history | Lightweight, temporary |

Use Git for permanent version control. Use checkpoints for safe experimentation within agent sessions.

## Try It Yourself

[Download Acepe](https://acepe.dev/download) and experience checkpoints with your own agent sessions. Every file edit is automatically tracked, and reverting is a single click.

---

**Next:** Learn about the [attention queue](/blog/attention-queue) for managing multiple agent sessions.
	`}
	/>
</BlogPostLayout>
