<!--
  AgentInputBranchSelector - Branch picker trigger + list using Selector.

  Presentational: host supplies branch data, selection, and optional create action.
  When create is enabled, the trigger and + button share a fused button group.
-->
<script lang="ts">
	import { ButtonGroup } from "../button-group/index.js";
	import { Button } from "../button/index.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import { Selector } from "../selector/index.js";
	import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
	import { getSelectorTriggerButtonVariant } from "../selector/selector-trigger-classes.js";
	import { cn } from "../../lib/utils.js";
	import { SelectorItem } from "../selector/index.js";
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

	const isSetupChip = $derived(variant === "setupBarChip" || variant === "setupBarChipGrouped");
	const useButtonGroup = $derived(showCreateButton);
	const embeddedInGroup = $derived(showCreateButton);

	const minimalTriggerClass =
		"!border-0 !h-[26px] rounded-md hover:rounded-full transition-[border-radius]";
	const setupBarLayoutClass = "w-auto flex-none";

	const triggerSize = $derived<SelectorTriggerSize>(
		embeddedInGroup
			? "setupBarChipGrouped"
			: variant === "setupBarChip"
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
		cn(isSetupChip ? setupBarLayoutClass : "", useButtonGroup ? className : "")
	);

</script>

{#snippet branchSelectorTrigger()}
	<HugeiconsIcon
		name="branch"
		class={cn(isSetupChip ? "text-foreground" : "size-3 shrink-0")}
		style={isSetupChip ? undefined : `color: ${branchIconColor}`}
	/>
	<span
		class="max-w-[9rem] truncate"
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
				<SelectorItem
					label={branch}
					selected={branch === currentBranch}
					labelClass="font-mono text-xs"
					onSelect={() => onBranchSelect(branch)}
				>
					{#snippet leading()}
						<HugeiconsIcon
							name="branch"
							class="size-3.5 shrink-0"
							style="color: {branchIconColor}"
						/>
					{/snippet}
				</SelectorItem>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet branchSelector(embedded: boolean)}
	{@const branchSelectorTriggerSize = embedded ? "setupBarChipGrouped" : triggerSize}
	<Selector
		bind:open
		{disabled}
		{onOpenChange}
		align="end"
		blockingOverlay
		variant={getSelectorTriggerButtonVariant(branchSelectorTriggerSize)}
		showChevron={!isSetupChip}
		class={selectorShellClass}
		triggerSize={branchSelectorTriggerSize}
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
		<Button
			variant="secondary"
			size="icon-sm-narrow"
			aria-label={createAriaLabel}
			title={createAriaLabel}
			disabled={createDisabled}
			onclick={() => onCreateClick?.()}
		>
			<HugeiconsIcon name="plus" size={14} />
		</Button>
	</ButtonGroup>
{:else}
	{@render branchSelector(false)}
{/if}
