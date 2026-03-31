# Inline Agent Error Card And Issue Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show agent connection/resume failures as an inline card above the agent input instead of replacing the whole panel, and let users open the existing in-app issue creation flow with a prefilled bug report.

**Architecture:** Create a new embedded error-card component for agent panels that follows the worktree setup card placement and sizing model. Keep the existing full-panel `ConnectionErrorUI` for contexts that truly need takeover UI, but route normal conversation-mode errors into the inline card. Add a small formatter/service layer that turns runtime/session/error context into a prefilled issue draft, then feed that draft into the existing user-reports issue creation UI instead of creating a second issue workflow.

**Tech Stack:** Svelte 5, SvelteKit 2, Tauri 2, Bun tests, existing Acepe user-reports GitHub issue flow

---

## File Structure

**Create:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-error-card.svelte` - inline conversation-mode error card above the input with retry/dismiss/create-issue actions
- `packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.ts` - formats agent/session/error context into a prefilled bug-report draft for the existing issue dialog

**Modify:**
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte` - render the new error card above `AgentInput`, gather session/worktree/error context, and open the existing issue dialog with a draft
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte` - stop using `ConnectionErrorUI` for normal conversation-mode panel errors
- `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-content-props.ts` - remove no-longer-needed full-screen error callbacks if the content component no longer owns that state
- `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts` - expose/update the existing issue modal state so it can accept a prefilled draft from the agent panel
- `packages/desktop/src/lib/components/user-reports/user-reports-container.svelte` - accept an optional prefilled draft and initialize the existing issue creator from it
- `packages/ui/src/components/user-reports/user-reports-create.svelte` - support initial title/body/category values passed in from desktop

**Test:**
- `packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-error-card.svelte.test.ts`
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte.test.ts`

### Task 1: Add Red Tests For Prefilled Issue Draft Formatting

**Files:**
- Create: `packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.test.ts`
- Create: `packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.ts`

- [ ] **Step 1: Write a failing test for formatted bug-report content**

Create `issue-report-draft.test.ts` with a single focused test:

```ts
import { describe, expect, it } from "bun:test";
import { buildAgentErrorIssueDraft } from "./issue-report-draft.js";

describe("buildAgentErrorIssueDraft", () => {
	it("formats a bug report with agent, session, project, worktree, and stack trace context", () => {
		const draft = buildAgentErrorIssueDraft({
			agentId: "claude-code",
			sessionId: "session-123",
			projectPath: "/Users/example/Documents/acepe",
			worktreePath: "/Users/example/.acepe/worktrees/feature-a",
			errorSummary: "Resume session timed out",
			errorDetails: "ERROR stack line 1\nstack line 2",
		});

		expect(draft.category).toBe("bug");
		expect(draft.title).toContain("Resume session timed out");
		expect(draft.body).toContain("Agent: claude-code");
		expect(draft.body).toContain("Session ID: session-123");
		expect(draft.body).toContain("Project Path: /Users/example/Documents/acepe");
		expect(draft.body).toContain("Worktree Path: /Users/example/.acepe/worktrees/feature-a");
		expect(draft.body).toContain("```text\nERROR stack line 1\nstack line 2\n```");
	});
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
bun test "src/lib/acp/components/agent-panel/logic/issue-report-draft.test.ts"
```

Expected: FAIL because `buildAgentErrorIssueDraft` does not exist yet.

- [ ] **Step 3: Implement the minimal draft formatter**

Create `issue-report-draft.ts` with:

```ts
export interface AgentErrorIssueDraftInput {
	agentId: string;
	sessionId: string | null;
	projectPath: string | null;
	worktreePath: string | null;
	errorSummary: string;
	errorDetails: string;
}

export interface AgentErrorIssueDraft {
	title: string;
	body: string;
	category: "bug";
}

export function buildAgentErrorIssueDraft(
	input: AgentErrorIssueDraftInput,
): AgentErrorIssueDraft {
	const title = `[${input.agentId}] ${input.errorSummary}`;
	const body = [
		"## Summary",
		input.errorSummary,
		"",
		"## Context",
		`- Agent: ${input.agentId}`,
		`- Session ID: ${input.sessionId ? input.sessionId : "unknown"}`,
		`- Project Path: ${input.projectPath ? input.projectPath : "unknown"}`,
		`- Worktree Path: ${input.worktreePath ? input.worktreePath : "none"}`,
		"",
		"## Error Details",
		"```text",
		input.errorDetails,
		"```",
	].join("\n");

	return { title, body, category: "bug" };
}
```

- [ ] **Step 4: Re-run the draft formatter test to verify it passes**

Run the same test command.

Expected: PASS.

### Task 2: Add Red Tests For The Inline Agent Error Card

**Files:**
- Create: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-error-card.svelte`
- Create: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-error-card.svelte.test.ts`
- Reference: `packages/desktop/src/lib/acp/components/agent-panel/components/worktree-setup-card.svelte`

- [ ] **Step 1: Write a failing component test for inline card actions and details toggle**

Create `agent-error-card.svelte.test.ts` with a focused test like:

```ts
import { describe, expect, it, mock } from "bun:test";
import { render, fireEvent } from "@testing-library/svelte";
import AgentErrorCard from "./agent-error-card.svelte";

describe("AgentErrorCard", () => {
	it("shows retry, dismiss, and create issue actions with expandable details", async () => {
		const onRetry = mock(() => {});
		const onDismiss = mock(() => {});
		const onCreateIssue = mock(() => {});

		const view = render(AgentErrorCard, {
			props: {
				title: "Resume session timed out",
				summary: "Claude failed to resume the session.",
				details: "stack line 1\nstack line 2",
				onRetry,
				onDismiss,
				onCreateIssue,
			},
		});

		expect(view.getByText("Resume session timed out")).toBeTruthy();
		await fireEvent.click(view.getByText("Create issue"));
		expect(onCreateIssue).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Retry"));
		expect(onRetry).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Dismiss"));
		expect(onDismiss).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByText("Details"));
		expect(view.getByText(/stack line 1/)).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
bun test "src/lib/acp/components/agent-panel/components/agent-error-card.svelte.test.ts"
```

Expected: FAIL because the component does not exist yet.

- [ ] **Step 3: Implement the minimal inline card component**

Create `agent-error-card.svelte` using the compact card style of `worktree-setup-card.svelte` rather than the full-panel takeover of `connection-error-ui.svelte`:

```svelte
<script lang="ts">
	import WarningCircle from "phosphor-svelte/lib/WarningCircle";
	import AnimatedChevron from "../../animated-chevron.svelte";

	interface Props {
		title: string;
		summary: string;
		details: string;
		onRetry: () => void;
		onDismiss: () => void;
		onCreateIssue: () => void;
	}

	let { title, summary, details, onRetry, onDismiss, onCreateIssue }: Props = $props();
	let isExpanded = $state(false);
</script>

<div class="w-full px-5 mb-2">
	{#if isExpanded}
		<div class="rounded-t-lg bg-accent/50 overflow-hidden">
			<div class="max-h-[220px] overflow-y-auto px-3 py-2">
				<pre class="font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{details}</pre>
			</div>
		</div>
	{/if}
	<div class="w-full rounded-lg bg-accent hover:bg-accent/80 transition-colors {isExpanded ? 'rounded-t-none' : ''}">
		<button type="button" class="w-full flex items-center justify-between px-3 py-1" onclick={() => (isExpanded = !isExpanded)}>
			<div class="flex items-center gap-1.5 min-w-0 text-[0.6875rem]">
				<WarningCircle size={13} weight="fill" class="shrink-0 text-destructive" />
				<span class="font-medium text-foreground shrink-0">{title}</span>
				<span class="truncate text-muted-foreground">{summary}</span>
			</div>
			<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
		</button>
		<div class="flex items-center justify-end gap-1 px-2 pb-2">
			<button type="button" class="h-6 px-2 text-[10px]" onclick={onDismiss}>Dismiss</button>
			<button type="button" class="h-6 px-2 text-[10px]" onclick={onCreateIssue}>Create issue</button>
			<button type="button" class="h-6 px-2 text-[10px]" onclick={onRetry}>Retry</button>
		</div>
	</div>
</div>
```

- [ ] **Step 4: Re-run the component test to verify it passes**

Run the same test command.

Expected: PASS.

### Task 3: Wire The Inline Card Into The Agent Panel Above The Input

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/types/agent-panel-content-props.ts`
- Test: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte.test.ts`

- [ ] **Step 1: Write a failing integration-style panel test**

Add a targeted test that mounts the panel (or the smallest testable wrapper) in conversation mode with an error and expects:

```ts
expect(screen.getByText("Resume session timed out")).toBeTruthy();
expect(screen.getByRole("textbox")).toBeTruthy();
```

The key behavior is: the input still exists while the error card is visible.

- [ ] **Step 2: Run the panel test to verify it fails**

Run the narrowest test command for that new panel test.

Expected: FAIL because the current implementation renders `ConnectionErrorUI` as a full-panel replacement.

- [ ] **Step 3: Move error rendering from panel content replacement into the main panel layout**

In `agent-panel-content.svelte`, remove the `{:else if viewState.kind === "error"}` full replacement branch and treat normal panel content as conversation-capable whenever messages/input should remain visible.

In `agent-panel.svelte`, render the new card directly above `AgentInput`, something shaped like:

```svelte
{#if errorInfo}
	<AgentErrorCard
		title={errorInfo.title}
		summary={errorInfo.summary}
		details={errorInfo.details}
		onRetry={handleRetryConnection}
		onDismiss={() => {
			panelConnectionError = null;
			connectionStore.clear?.(effectivePanelId);
		}}
		onCreateIssue={handleCreateIssueFromError}
	/>
{/if}
```

Place it immediately before the input/footer region, matching the placement of the worktree setup card.

- [ ] **Step 4: Re-run the panel test to verify it passes**

Expected: PASS.

### Task 4: Reuse The Existing Issue Dialog With Prefilled Drafts

**Files:**
- Modify: `packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts`
- Modify: `packages/desktop/src/lib/components/user-reports/user-reports-container.svelte`
- Modify: `packages/ui/src/components/user-reports/user-reports-create.svelte`
- Test: add the smallest state/logic test if one exists nearby; otherwise rely on `bun run check` plus agent-panel draft unit tests

- [ ] **Step 1: Add a failing test or type assertion for prefilled issue state**

If there is an existing state test harness, add one proving the user-reports modal can open with:

```ts
{
	category: "bug",
	title: "[claude-code] Resume session timed out",
	body: "..."
}
```

If no such harness exists, add a narrow unit test around a new helper or state setter in `main-app-view-state.svelte.ts`.

- [ ] **Step 2: Run that focused test/check to verify it fails**

Use the narrowest runnable test or `bun run check` if the failure is purely type/API level.

- [ ] **Step 3: Thread prefilled draft support through the existing issue UI**

Add a shared draft type in desktop code:

```ts
export interface PrefilledIssueDraft {
	category: "bug" | "enhancement" | "question" | "discussion";
	title: string;
	body: string;
}
```

Update main-app-view state to store an optional `prefilledIssueDraft`, and expose an action like:

```ts
openUserReportsWithDraft(draft: PrefilledIssueDraft): void
```

Update `user-reports-container.svelte` and `user-reports-create.svelte` so the existing form initializes from the provided draft instead of always starting empty.

- [ ] **Step 4: Re-run the focused test/check to verify it passes**

Expected: PASS.

### Task 5: Connect The Error Card To The Existing Issue Dialog

**Files:**
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Modify: `packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.ts`

- [ ] **Step 1: Add a failing panel-level test for `Create issue` opening the modal draft path**

In the same panel test file, add a test that clicks `Create issue` and expects the issue-modal state opener to be called with a formatted draft.

- [ ] **Step 2: Run the focused test to verify it fails**

Run the narrowest test command for that new case.

Expected: FAIL because `handleCreateIssueFromError` does not exist yet.

- [ ] **Step 3: Implement `handleCreateIssueFromError` in `agent-panel.svelte`**

Add a handler shaped like:

```ts
function handleCreateIssueFromError(): void {
	const details = errorInfo?.details ?? panelConnectionError ?? sessionConnectionError ?? "Unknown error";
	const summary = errorInfo?.summary ?? errorInfo?.title ?? "Agent panel error";
	const draft = buildAgentErrorIssueDraft({
		agentId: sessionAgentId ?? selectedAgentId ?? "unknown",
		sessionId,
		projectPath: sessionProjectPath,
		worktreePath: sessionWorktreePath,
		errorSummary: summary,
		errorDetails: details,
	});
	mainAppViewState.openUserReportsWithDraft(draft);
}
```

Keep it tiny and reuse the existing issue-dialog state instead of introducing a second modal.

- [ ] **Step 4: Re-run the focused test to verify it passes**

Expected: PASS.

### Task 6: Full Targeted Verification

**Files:**
- Verify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-error-card.svelte`
- Verify: `packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.ts`
- Verify: `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- Verify: `packages/desktop/src/lib/components/user-reports/user-reports-container.svelte`
- Verify: `packages/ui/src/components/user-reports/user-reports-create.svelte`

- [ ] **Step 1: Run the focused UI/unit tests you added**

Run commands like:

```bash
bun test "src/lib/acp/components/agent-panel/logic/issue-report-draft.test.ts" "src/lib/acp/components/agent-panel/components/agent-error-card.svelte.test.ts" "src/lib/acp/components/agent-panel/components/agent-panel.svelte.test.ts"
```

Expected: PASS.

- [ ] **Step 2: Run project verification**

Run from `packages/desktop`:

```bash
bun run i18n:generate && bun run check
```

Expected: PASS.

- [ ] **Step 3: Commit once verification is green**

```bash
git add packages/desktop/src/lib/acp/components/agent-panel/components/agent-error-card.svelte packages/desktop/src/lib/acp/components/agent-panel/logic/issue-report-draft.ts packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-content.svelte packages/desktop/src/lib/components/main-app-view/logic/main-app-view-state.svelte.ts packages/desktop/src/lib/components/user-reports/user-reports-container.svelte packages/ui/src/components/user-reports/user-reports-create.svelte
git commit -m "feat: show inline agent error card with issue reporting"
```

If tests required additional files, add them explicitly.

---

## Self-Review

- Spec coverage: the plan covers inline rendering, preserving the input area, prefilled issue formatting, and reuse of the existing issue dialog.
- Placeholder scan: no `TODO` or vague “handle errors” placeholders remain; each step has files, code, and commands.
- Type consistency: the plan uses one `PrefilledIssueDraft` concept and one `buildAgentErrorIssueDraft()` formatter throughout.

Plan complete and saved to `docs/superpowers/plans/2026-03-27-inline-agent-error-card-and-issue-dialog.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
