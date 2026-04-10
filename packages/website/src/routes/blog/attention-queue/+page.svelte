<script lang="ts">
import BlogPostLayout from "$lib/blog/blog-post-layout.svelte";
import { attentionQueueBlogPost as metadata } from "$lib/blog/posts.js";
import { MarkdownDisplay } from "@acepe/ui";
import FullQueueDemo from "$lib/blog/demos/queue-full-demo.svelte";
import AnswerNeededDemo from "$lib/blog/demos/queue-answer-needed-demo.svelte";
import WorkingDemo from "$lib/blog/demos/queue-working-demo.svelte";
import PlanningDemo from "$lib/blog/demos/queue-planning-demo.svelte";
import ErrorDemo from "$lib/blog/demos/queue-error-demo.svelte";
import FinishedDemo from "$lib/blog/demos/queue-finished-demo.svelte";

let { data } = $props();
</script>

<BlogPostLayout
		{metadata}
		showDownload={data.featureFlags.downloadEnabled}
		showLogin={data.featureFlags.loginEnabled}
	>
	<FullQueueDemo />

	<MarkdownDisplay
		content={`
# What is the Attention Queue?

When you're working with AI coding agents, you might have multiple sessions running simultaneously—one debugging a performance issue, another writing tests, and a third reviewing your architecture. How do you know which one needs your attention right now?

That's where Acepe's **attention queue** comes in. Instead of hunting through terminal windows or losing track of what's happening, the attention queue automatically organizes your active sessions by urgency. Sessions that need your input surface at the top. Sessions with errors get priority over idle ones. And sessions that are actively working stay visible so you never lose context.

## Why It Matters

Traditional CLI tools treat all agent sessions equally. Whether an agent is waiting for you to answer a critical question or quietly sitting idle, they all look the same in your terminal. You have to remember which session is which, manually check each one, and context-switch constantly.

The attention queue solves this by **sorting sessions by urgency**:

- **Answer needed** — Agent is blocked waiting for your response
- **Error** — Something went wrong and needs attention  
- **Working** — Agent is actively making progress
- **Planning** — Agent is thinking about next moves
- **Finished** — Task completed successfully

You always know what needs attention and can make informed decisions about where to focus.
	`}
	/>

	<section class="my-12">
		<h2 class="mb-6 text-3xl font-bold">States Explained</h2>

		<div class="space-y-16">
			<!-- Answer Needed State -->
			<div>
				<MarkdownDisplay
					content={`
### Answer Needed

When an agent encounters a decision point—like choosing between authentication strategies or picking a library—it presents you with options. Sessions with pending questions automatically move to the top of the queue, ensuring you never miss a blocking question.

**Try it:** Select an answer in the demo below to see how questions work.
					`}
				/>
				<AnswerNeededDemo />
			</div>

			<!-- Working State -->
			<div>
				<MarkdownDisplay
					content={`
### Working

Active sessions show real-time progress. You can see:

- **Todo progress** (3/5 tasks complete)
- **File being edited** (currently modifying api-routes.ts)
- **Diff stats** (67 insertions, 23 deletions)
- **Time elapsed** (2 minutes ago)

This visibility helps you gauge progress without interrupting the agent.
					`}
				/>
				<WorkingDemo />
			</div>

			<!-- Planning State -->
			<div>
				<MarkdownDisplay
					content={`
### Planning vs Building

Agents operate in two modes: **plan** and **build**. In plan mode, the agent researches, explores patterns, and designs an implementation approach before writing code. This reduces wasted effort and ensures alignment.

When an agent is planning, the queue shows a "Planning next moves..." status with a shimmer effect, indicating active thinking.
					`}
				/>
				<PlanningDemo />
			</div>

			<!-- Error State -->
			<div>
				<MarkdownDisplay
					content={`
### Error Handling

When an agent encounters an error—missing environment variables, build failures, test failures—the session moves to the error section. The status message explains what went wrong so you can quickly diagnose and fix the issue.

Errors have high urgency, appearing near the top of the queue (right after answer-needed sessions).
					`}
				/>
				<ErrorDemo />
			</div>

			<!-- Finished State -->
			<div>
				<MarkdownDisplay
					content={`
### Finished

Completed tasks show final statistics: total insertions and deletions, completion time, and final todo status. Finished sessions automatically deprioritize to the bottom of the queue, keeping your focus on active work.
					`}
				/>
				<FinishedDemo />
			</div>
		</div>
	</section>

	<MarkdownDisplay
		content={`
## How It Works Under the Hood

The attention queue uses **urgency classification** to sort sessions:

1. **Answer needed** — Highest priority (user input required)
2. **Error** — High priority (something broke)
3. **Working** — Medium priority (active progress)
4. **Planning** — Medium priority (thinking phase)
5. **Finished** — Low priority (completed)

Sessions within the same priority level are further sorted by recency, so the most recently updated session appears first.

## Beyond the CLI

Unlike terminal-based agent tools, Acepe's queue provides:

- **Visual scanning** — See all sessions at a glance
- **Interactive questions** — Click to answer, no copy-paste required
- **Progress indicators** — Circular progress for todos, shimmer for active work
- **Project badges** — Color-coded projects for context
- **Diff pills** — Inline +67/-23 stats without opening files

## When to Use It

The attention queue shines when you're:

- **Running parallel agents** — Debugging in one session while another writes tests
- **Managing multiple projects** — Switching between frontend, backend, and infrastructure work
- **Handling interruptions** — Come back after a meeting and instantly know where you left off
- **Coordinating team work** — Share screen to show agent progress without terminal chaos

## Try It Yourself

[Download Acepe](https://acepe.dev/download) and experience the attention queue with your own agent sessions. Connect Claude Code, Cursor Agent, Codex, or any ACP-compatible agent, and let the queue manage your context for you.

---

**Next:** Learn about [checkpoints and time-travel debugging](#) in Acepe.
	`}
	/>
</BlogPostLayout>
