<!--
  AgentInputNewThreadOptions - Floating setup chips shown above the composer when
  a new chat panel has no session yet. Worktree checkbox is solid green when on.

  Presentational only. Project / Agent / Branch render as individual chips;
  Worktree + settings share a fused button group. Model and reasoning live in the
  composer trailing toolbar, not here.
  (Auto-approve lives in the composer attach menu, not here.)
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { ButtonGroup } from "../button-group/index.js";
	import { ComposerOverflowMenu } from "../composer/index.js";
	import {
		FUSED_CONTROL_CHIP_GROUP_CLASS,
		FUSED_CONTROL_OVERFLOW_BUTTON_CLASS,
		FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS,
		FUSED_CONTROL_SETUP_GROUPED_CHIP_LABEL_BUTTON_CLASS,
	} from "../panel-header/index.js";
	import { Switch } from "../switch/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import { cn } from "../../lib/utils.js";

	interface Props {
		worktreeLabel?: string;
		/** Label for the "default for new sessions" menu item. */
		worktreeDefaultLabel?: string;
		settingsLabel?: string;
		/** Control snippets for the selector chips. */
		project: Snippet;
		agent: Snippet;
		/** Optional branch picker snippet (host wraps desktop BranchPicker). */
		branch?: Snippet;
		/** Optional extra settings menu content rendered above the worktree default row. */
		settingsMenu?: Snippet;
		/** Hide the worktree toggle when worktrees do not apply (e.g. not a git repo). */
		showWorktree?: boolean;
		worktreeOn: boolean;
		worktreeDisabled?: boolean;
		onWorktreeToggle: (on: boolean) => void;
		/** Whether new sessions default to using a worktree (persisted preference). */
		worktreeDefaultOn?: boolean;
		onWorktreeDefaultToggle?: (on: boolean) => void;
		align?: "start" | "center";
	}

	let {
		worktreeLabel = "Worktree",
		worktreeDefaultLabel = "Use worktrees by default",
		settingsLabel = "Session setup",
		project,
		agent,
		branch,
		settingsMenu,
		showWorktree = true,
		worktreeOn,
		worktreeDisabled = false,
		onWorktreeToggle,
		worktreeDefaultOn = false,
		onWorktreeDefaultToggle,
		align = "center",
	}: Props = $props();

	const rowAlignClass = $derived(align === "start" ? "justify-start" : "mx-auto justify-center");

	const setupChipButtonClass =
		"[&_button]:flex [&_button]:flex-none [&_button]:items-center [&_button]:gap-1 [&_button]:text-muted-foreground [&_button]:transition-colors [&_button:hover]:bg-accent [&_button:hover]:text-foreground";

	const worktreeTriggerClass = $derived(
		cn(
			FUSED_CONTROL_SETUP_GROUPED_CHIP_LABEL_BUTTON_CLASS,
			"disabled:pointer-events-none disabled:opacity-50",
			worktreeOn ? "text-[var(--success)]" : "text-muted-foreground"
		)
	);

	const worktreeCheckboxClass = $derived(
		cn(
			"flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
			worktreeOn
				? "border-[var(--success)] bg-[var(--success)] text-[var(--success-foreground)]"
				: "border-border/80 bg-transparent"
		)
	);
</script>

<div
	data-testid="new-thread-options"
	class="flex max-w-full flex-wrap items-center gap-0.5 text-xs {rowAlignClass} {setupChipButtonClass}"
>
	{@render project()}
	{@render agent()}
	{#if branch}
		{@render branch()}
	{/if}

	{#if showWorktree}
		<ButtonGroup
			class={cn(
				FUSED_CONTROL_CHIP_GROUP_CLASS,
				"min-h-[23px] [&_[data-slot=button]]:min-h-[23px]"
			)}
		>
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
									<span
										class="block h-[7px] w-[3.5px] translate-y-[-0.5px] rotate-45 border-b-2 border-r-2 border-current"
									></span>
								{/if}
							</span>
							<span class={FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS}>{worktreeLabel}</span>
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

			<ComposerOverflowMenu
				ariaLabel={settingsLabel}
				triggerIcon="dots"
				contentClass="min-w-[15rem]"
				triggerClass={FUSED_CONTROL_OVERFLOW_BUTTON_CLASS}
			>
				{#if settingsMenu}
					{@render settingsMenu()}
				{/if}
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
			</ComposerOverflowMenu>
		</ButtonGroup>
	{/if}
</div>
