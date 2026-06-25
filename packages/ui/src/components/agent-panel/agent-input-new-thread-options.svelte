<!--
  AgentInputNewThreadOptions - A single compact row shown above the composer when
  a new chat panel has no session yet.

  Presentational only. Project / Agent / Model controls are passed as snippets by
  the host (they wrap desktop selectors) and render as inline chips. Worktree
  is the leftmost icon-only toggle (filled tree; green when on) with overflow menu.
  Reasoning renders via AgentInputSetupReasoning (brain icon + dropdown) to the right of the model chip.
  (Auto-approve lives in the composer toolbar, not here.)
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { Tree } from "phosphor-svelte";

	import {
		FUSED_CONTROL_CHIP_GROUP_CLASS,
		FUSED_CONTROL_PRIMARY_BUTTON_CLASS,
		FusedOverflowDotsTrigger,
		FusedPrimaryOverflowGroup,
	} from "../panel-header/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Switch } from "../switch/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import AgentInputSetupReasoning from "./agent-input-setup-reasoning.svelte";

	interface Props {
		worktreeLabel?: string;
		/** Label for the "default for new sessions" menu item. */
		worktreeDefaultLabel?: string;
		/** Control snippets for the selector chips. */
		project: Snippet;
		agent: Snippet;
		model: Snippet;
		/** Reasoning config option; when set, shows brain dropdown to the right of model. */
		reasoningConfigOption?: AgentInputConfigOption | null;
		reasoningDisabled?: boolean;
		onReasoningValueChange?: (configId: string, value: string) => void;
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
		reasoningConfigOption = null,
		reasoningDisabled = false,
		onReasoningValueChange,
		showWorktree = true,
		worktreeOn,
		worktreeDisabled = false,
		onWorktreeToggle,
		worktreeDefaultOn = false,
		onWorktreeDefaultToggle,
	}: Props = $props();

	const showReasoning = $derived(reasoningConfigOption !== null);

	const TOGGLE_ICON = 15;
	const setupChipGroupClass = FUSED_CONTROL_CHIP_GROUP_CLASS;
	const setupChipButtonClass =
		"[&_button]:flex [&_button]:flex-none [&_button]:items-center [&_button]:gap-1 [&_button]:rounded-md [&_button]:bg-transparent [&_button]:text-muted-foreground [&_button]:transition-colors [&_button:hover]:bg-accent [&_button:hover]:text-foreground";
</script>

<div
	data-testid="new-thread-options"
	class="mx-auto flex w-fit max-w-full items-center gap-2 rounded-lg border border-border/40 bg-input/20 py-[3px] px-1"
>
	{#if showWorktree}
		<FusedPrimaryOverflowGroup>
			{#snippet primary()}
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
								class="{FUSED_CONTROL_PRIMARY_BUTTON_CLASS} disabled:pointer-events-none disabled:opacity-50 {worktreeOn
									? 'text-[var(--success)]'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								<Tree size={TOGGLE_ICON} weight="fill" />
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
			{/snippet}
			{#snippet overflow()}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<FusedOverflowDotsTrigger {...props} ariaLabel="Worktree options" />
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
			{/snippet}
		</FusedPrimaryOverflowGroup>
	{/if}

	<!-- Selector chips: project / agent / model (+ optional reasoning) -->
	<div class="flex items-center gap-2 text-xs">
		<div class="{setupChipGroupClass} flex items-center gap-2 {setupChipButtonClass}">
			{@render project()}
			{@render agent()}
			{@render model()}
		</div>
		{#if showReasoning && reasoningConfigOption}
			<div class="setup-chip {setupChipGroupClass} {setupChipButtonClass}">
				<AgentInputSetupReasoning
					configOption={reasoningConfigOption}
					disabled={reasoningDisabled || onReasoningValueChange === undefined}
					onValueChange={onReasoningValueChange ?? (() => {})}
				/>
			</div>
		{/if}
	</div>
</div>
