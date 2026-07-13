<!--
  AgentInputNewThreadOptions - Floating setup chips shown above the composer when
  a new chat panel has no session yet. Worktree checkbox is solid green when on.

  Presentational only. Project, agent, branch, and worktree render as individual chips.
  Model and reasoning live in the composer trailing toolbar, not here.
  (Auto-approve lives in the composer attach menu, not here.)
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { buttonVariants } from "../button/variants.js";
	import * as Tooltip from "../tooltip/index.js";
	import { cn } from "../../lib/utils.js";
	import { InterfaceIcon } from "../icons/index.js";

	interface Props {
		worktreeLabel?: string;
		/** Control snippets for the selector chips. */
		project: Snippet;
		agent: Snippet;
		/** Optional branch picker snippet (host wraps desktop BranchPicker). */
		branch?: Snippet;
		/** Hide the worktree toggle when worktrees do not apply (e.g. not a git repo). */
		showWorktree?: boolean;
		worktreeOn: boolean;
		worktreeDisabled?: boolean;
		onWorktreeToggle: (on: boolean) => void;
		align?: "start" | "center";
	}

	let {
		worktreeLabel = "Worktree",
		project,
		agent,
		branch,
		showWorktree = true,
		worktreeOn,
		worktreeDisabled = false,
		onWorktreeToggle,
		align = "center",
	}: Props = $props();

	const rowAlignClass = $derived(align === "start" ? "justify-start" : "mx-auto justify-center");

	const worktreeTriggerClass = $derived(
		cn(
			buttonVariants({ variant: "secondary", size: "sm" }),
			"gap-1 disabled:pointer-events-none disabled:opacity-50",
			worktreeOn ? "text-[var(--success)]" : ""
		)
	);

	const worktreeCheckboxClass = $derived(
		cn(
			"flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
			worktreeOn
				? "border-[var(--success)] bg-[var(--success)] text-[var(--success-foreground)]"
				: "border-muted-foreground/30 bg-secondary-foreground/[0.04]"
		)
	);
</script>

<div
	data-testid="new-thread-options"
	class="flex max-w-full flex-wrap items-center gap-0.5 text-xs {rowAlignClass}"
>
	{@render project()}
	{@render agent()}
	{#if branch}
		{@render branch()}
	{/if}

	{#if showWorktree}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						data-slot="button"
						type="button"
						role="checkbox"
						aria-label={worktreeLabel}
						aria-checked={worktreeOn}
						disabled={worktreeDisabled}
						onclick={() => onWorktreeToggle(!worktreeOn)}
						class={worktreeTriggerClass}
					>
						<span aria-hidden="true" class={worktreeCheckboxClass}>
							{#if worktreeOn}
								<InterfaceIcon name="check" class="size-2.5" />
							{/if}
						</span>
						<span>{worktreeLabel}</span>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="top" class="max-w-[17rem] leading-relaxed">
				<span class="font-semibold">{worktreeLabel}</span>
				<span class="mt-1 block font-normal">
					Run this thread in an isolated Git worktree: a separate working copy on its own
					branch. The agent's file edits, commits, and commands stay off your current checkout,
					so your branch is untouched until you review and merge. When off, the agent works
					directly in your current working tree.
				</span>
			</Tooltip.Content>
		</Tooltip.Root>
	{/if}
</div>
