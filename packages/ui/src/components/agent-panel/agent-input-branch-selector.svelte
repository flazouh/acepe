<!--
  AgentInputBranchSelector - Branch picker trigger + list using Selector.

  Presentational: host supplies branch data, selection, and optional create action.
  When create is enabled, the trigger and + button share a fused button group.
-->
<script lang="ts">
	import { GitBranch, Plus } from "phosphor-svelte";

	import { ButtonGroup } from "../button-group/index.js";
	import { DiffPill } from "../diff-pill/index.js";
	import {
		FUSED_CONTROL_CHIP_GROUP_CLASS,
		FUSED_CONTROL_OVERFLOW_BUTTON_CLASS,
		FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS,
		FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX,
		FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS,
		OVERFLOW_DOTS_ICON_CLASS,
	} from "../panel-header/project-card-action-button-class.js";
	import { Selector } from "../selector/index.js";
	import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
	import { cn } from "../../lib/utils.js";
	import AgentInputSelectorItemRow from "./agent-input-selector-item-row.svelte";
	import type {
		AgentInputBranchListDisplay,
		AgentInputBranchSelectorVariant,
	} from "./agent-input-branch-selector-types.js";

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		disabled?: boolean;
		currentBranch: string | null;
		diffStats?: { insertions: number; deletions: number } | null;
		branchListDisplay: AgentInputBranchListDisplay;
		branchIconColor?: string;
		onBranchSelect: (branch: string) => void;
		showCreateButton?: boolean;
		onCreateClick?: () => void;
		createDisabled?: boolean;
		createAriaLabel?: string;
		variant?: AgentInputBranchSelectorVariant;
		class?: string;
	}

	let {
		open = $bindable(false),
		onOpenChange,
		disabled = false,
		currentBranch,
		diffStats = null,
		branchListDisplay,
		branchIconColor = "var(--foreground)",
		onBranchSelect,
		showCreateButton = false,
		onCreateClick,
		createDisabled = false,
		createAriaLabel = "Create branch",
		variant = "default",
		class: className = "",
	}: Props = $props();

	const isSetupChip = $derived(variant === "setupChip" || variant === "setupChipGrouped");
	const useButtonGroup = $derived(showCreateButton);
	const embeddedInGroup = $derived(showCreateButton);

	const minimalTriggerClass =
		"!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius]";
	const setupBarLayoutClass = "w-auto flex-none";

	const triggerSize = $derived<SelectorTriggerSize>(
		embeddedInGroup
			? "setupBarChipGrouped"
			: variant === "setupChip"
				? "setupBarChip"
				: variant === "minimal"
					? "minimal"
					: "default"
	);

	const branchTriggerClass = $derived(
		isSetupChip
			? setupBarLayoutClass
			: variant === "minimal"
				? minimalTriggerClass
				: undefined
	);

	const selectorShellClass = $derived(
		cn(
			isSetupChip ? setupBarLayoutClass : variant === "default" ? "h-full w-full" : "",
			!useButtonGroup ? className : ""
		)
	);

	const buttonGroupClass = $derived(
		cn(
			FUSED_CONTROL_CHIP_GROUP_CLASS,
			isSetupChip ? "min-h-[23px] [&_[data-slot=button]]:min-h-[23px]" : "",
			isSetupChip ? setupBarLayoutClass : "",
			useButtonGroup ? className : ""
		)
	);

</script>

{#snippet branchSelectorTrigger()}
	<GitBranch
		class={cn(
			isSetupChip ? FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS : "size-3 shrink-0",
			isSetupChip ? "text-foreground" : ""
		)}
		size={isSetupChip ? FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX : undefined}
		weight="fill"
		style={isSetupChip ? undefined : `color: ${branchIconColor}`}
	/>
	<span
		class={cn("max-w-[9rem] truncate", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)}
		title={currentBranch || "branch"}
	>
		{currentBranch || "branch"}
	</span>
	{#if diffStats && !isSetupChip}
		<DiffPill insertions={diffStats.insertions} deletions={diffStats.deletions} variant="plain" />
	{/if}
{/snippet}

{#snippet branchSelectorDropdown()}
	{#if branchListDisplay.kind === "loading"}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">{branchListDisplay.message}</div>
	{:else if branchListDisplay.kind === "failed"}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">{branchListDisplay.message}</div>
	{:else if branchListDisplay.kind === "empty"}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">{branchListDisplay.message}</div>
	{:else if branchListDisplay.kind === "branches"}
		<div class="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-0 pb-1 scrollbar-thin">
			{#each branchListDisplay.branches as branch (branch)}
				<AgentInputSelectorItemRow
					label={branch}
					selected={branch === currentBranch}
					labelClass="font-mono text-xs"
					onSelect={() => onBranchSelect(branch)}
				>
					{#snippet leading()}
						<GitBranch
							class="size-3.5 shrink-0"
							weight="fill"
							style="color: {branchIconColor}"
						/>
					{/snippet}
				</AgentInputSelectorItemRow>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet branchSelector(embedded: boolean)}
	<Selector
		bind:open
		{disabled}
		{onOpenChange}
		align="end"
		blockingOverlay
		variant="ghost"
		showChevron={!isSetupChip}
		class={selectorShellClass}
		triggerSize={embedded ? "setupBarChipGrouped" : triggerSize}
		triggerClass={branchTriggerClass}
		embeddedInGroup={embedded}
		side="top"
		sideOffset={8}
		triggerAriaLabel={currentBranch ? `Branch: ${currentBranch}` : "Select branch"}
	>
		{#snippet renderButton()}
			{@render branchSelectorTrigger()}
		{/snippet}

		{@render branchSelectorDropdown()}
	</Selector>
{/snippet}

{#if useButtonGroup}
	<ButtonGroup class={buttonGroupClass}>
		{@render branchSelector(true)}
		<button
			type="button"
			data-slot="button"
			class={FUSED_CONTROL_OVERFLOW_BUTTON_CLASS}
			aria-label={createAriaLabel}
			title={createAriaLabel}
			disabled={createDisabled}
			onclick={() => onCreateClick?.()}
		>
			<Plus class={OVERFLOW_DOTS_ICON_CLASS} weight="bold" />
		</button>
	</ButtonGroup>
{:else}
	{@render branchSelector(false)}
{/if}
