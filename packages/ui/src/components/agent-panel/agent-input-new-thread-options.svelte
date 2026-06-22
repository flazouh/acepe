<!--
  AgentInputNewThreadOptions - A single compact row shown above the composer when
  a new chat panel has no session yet.

  Presentational only. Project / Agent / Model controls are passed as snippets by
  the host (they wrap desktop selectors) and render as inline chips. Worktree
  renders as an icon toggle with label. Outline icon when off, filled green when on.
  (Auto-approve lives in the composer toolbar, not here.)
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { Tree, DotsThreeVertical } from "phosphor-svelte";

	import { ButtonGroup } from "../button-group/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Switch } from "../switch/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		worktreeLabel?: string;
		/** Label for the "default for new sessions" menu item. */
		worktreeDefaultLabel?: string;
		/** Control snippets for the selector chips. */
		project: Snippet;
		agent: Snippet;
		model: Snippet;
		/** Optional reasoning bar control (bar only, no label). */
		reasoning?: Snippet;
		showReasoning?: boolean;
		/** Hide the worktree toggle when worktrees do not apply (e.g. not a git repo). */
		showWorktree?: boolean;
		worktreeOn: boolean;
		worktreeDisabled?: boolean;
		onWorktreeToggle: (on: boolean) => void;
		/** Whether new sessions default to using a worktree (persisted preference). */
		worktreeDefaultOn?: boolean;
		onWorktreeDefaultToggle?: (on: boolean) => void;
	}

	let {
		worktreeLabel = "Worktree",
		worktreeDefaultLabel = "Use worktrees by default",
		project,
		agent,
		model,
		reasoning,
		showReasoning = false,
		showWorktree = true,
		worktreeOn,
		worktreeDisabled = false,
		onWorktreeToggle,
		worktreeDefaultOn = false,
		onWorktreeDefaultToggle,
	}: Props = $props();

	const TOGGLE_ICON = 15;
	const setupChipGroupClass = "overflow-hidden rounded-md bg-accent/30";
	const setupChipButtonClass =
		"[&_button]:flex [&_button]:flex-none [&_button]:items-center [&_button]:gap-1 [&_button]:rounded-md [&_button]:bg-transparent [&_button]:text-muted-foreground [&_button]:transition-colors [&_button:hover]:bg-accent [&_button:hover]:text-foreground";
	const setupWorktreeButtonClass =
		"flex h-auto shrink-0 items-center justify-center gap-1 py-1 transition-colors hover:bg-accent";
	const modelReasoningModelClass = "model-reasoning-group__model flex min-h-full items-stretch";
	const modelReasoningReasoningClass =
		"model-reasoning-group__reasoning flex w-2.5 min-w-2.5 shrink-0 basis-2.5 items-stretch border-l border-border/40";
	const modelReasoningGroupClass = cn(
		setupChipGroupClass,
		setupChipButtonClass,
		"items-stretch",
		"[&_.model-reasoning-group__model_[role=group]_button]:box-border [&_.model-reasoning-group__model_[role=group]_button]:inline-flex [&_.model-reasoning-group__model_[role=group]_button]:items-center [&_.model-reasoning-group__model_[role=group]_button]:gap-1 [&_.model-reasoning-group__model_[role=group]_button]:rounded-none [&_.model-reasoning-group__model_[role=group]_button]:border-0 [&_.model-reasoning-group__model_[role=group]_button]:bg-transparent [&_.model-reasoning-group__model_[role=group]_button]:px-1.5 [&_.model-reasoning-group__model_[role=group]_button]:pe-1 [&_.model-reasoning-group__model_[role=group]_button]:text-xs [&_.model-reasoning-group__model_[role=group]_button]:leading-4 [&_.model-reasoning-group__model_[role=group]_button]:text-muted-foreground [&_.model-reasoning-group__model_[role=group]_button]:shadow-none [&_.model-reasoning-group__model_[role=group]_button]:rounded-s-md",
		"[&_.model-reasoning-group__model_[role=group]_button:hover]:bg-accent [&_.model-reasoning-group__model_[role=group]_button:hover]:text-foreground",
		"[&_.model-reasoning-group__reasoning_button]:relative [&_.model-reasoning-group__reasoning_button]:overflow-hidden [&_.model-reasoning-group__reasoning_button]:flex [&_.model-reasoning-group__reasoning_button]:h-full [&_.model-reasoning-group__reasoning_button]:w-full [&_.model-reasoning-group__reasoning_button]:min-w-full [&_.model-reasoning-group__reasoning_button]:items-stretch [&_.model-reasoning-group__reasoning_button]:justify-stretch [&_.model-reasoning-group__reasoning_button]:gap-0 [&_.model-reasoning-group__reasoning_button]:rounded-none [&_.model-reasoning-group__reasoning_button]:border-0 [&_.model-reasoning-group__reasoning_button]:bg-transparent [&_.model-reasoning-group__reasoning_button]:p-0 [&_.model-reasoning-group__reasoning_button]:text-muted-foreground [&_.model-reasoning-group__reasoning_button]:shadow-none [&_.model-reasoning-group__reasoning_button]:rounded-e-md",
		"[&_.model-reasoning-group__reasoning_button:hover]:bg-accent [&_.model-reasoning-group__reasoning_button:hover]:text-foreground",
		"[&_.model-reasoning-group__reasoning_[data-variant=setupReasoningBar]]:min-h-0 [&_.model-reasoning-group__reasoning_[data-variant=setupReasoningBar]]:h-full [&_.model-reasoning-group__reasoning_[data-variant=setupReasoningBar]]:w-full [&_.model-reasoning-group__reasoning_[data-variant=setupReasoningBar]]:flex-1"
	);
</script>

<div
	data-testid="new-thread-options"
	class="mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-border/40 bg-input/20 py-[3px] px-1"
>
	<!-- Selector chips: project / agent / model (+ optional reasoning) -->
	<div class="flex items-center gap-1 text-xs">
		<div class="setup-chip flex items-center gap-1">
			<div class="{setupChipGroupClass} {setupChipButtonClass}">
				{@render project()}
			</div>
			<div class="{setupChipGroupClass} {setupChipButtonClass}">
				{@render agent()}
			</div>
		</div>
		{#if showReasoning && reasoning}
			<ButtonGroup
				data-testid="model-reasoning-group"
				class="model-reasoning-group {modelReasoningGroupClass}"
			>
				<div class={modelReasoningModelClass}>
					{@render model()}
				</div>
				<div class={modelReasoningReasoningClass}>
					{@render reasoning()}
				</div>
			</ButtonGroup>
		{:else}
			<div class="setup-chip {setupChipGroupClass} {setupChipButtonClass}">
				{@render model()}
			</div>
		{/if}
	</div>

	{#if showWorktree}
		<ButtonGroup class="{setupChipGroupClass}">
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							data-slot="button"
							type="button"
							aria-label={worktreeLabel}
							aria-pressed={worktreeOn}
							disabled={worktreeDisabled}
							onclick={() => onWorktreeToggle(!worktreeOn)}
							class="{setupWorktreeButtonClass} px-1.5 disabled:pointer-events-none disabled:opacity-50 {worktreeOn
								? 'text-[var(--success)]'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							<Tree size={TOGGLE_ICON} weight={worktreeOn ? "fill" : "regular"} />
							<span class="whitespace-nowrap text-xs">{worktreeLabel}</span>
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
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							data-slot="button"
							type="button"
							aria-label="Worktree options"
							class="{setupWorktreeButtonClass} w-4 border-l border-border/30 px-1 text-muted-foreground hover:text-foreground"
						>
							<DotsThreeVertical size={14} weight="bold" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content side="top" align="end" class="min-w-[15rem]">
					<div
						class="flex items-center justify-between gap-3 px-2 py-1.5"
						role="presentation"
						onclick={(event) => event.stopPropagation()}
						onkeydown={(event) => event.stopPropagation()}
					>
						<span class="min-w-0 text-[11px] text-foreground">{worktreeDefaultLabel}</span>
						<Switch
							checked={worktreeDefaultOn}
							onCheckedChange={(checked) => {
								onWorktreeDefaultToggle?.(checked === true);
							}}
							aria-label={worktreeDefaultLabel}
						/>
					</div>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</ButtonGroup>
	{/if}
</div>
