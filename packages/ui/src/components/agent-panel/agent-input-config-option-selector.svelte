<!--
  AgentInputConfigOptionSelector - Toolbar button for a config option (fast mode, reasoning, etc).

  Accepts a normalized config option shape; desktop derives AgentInputConfigOption from session state.
-->
<script lang="ts">
	import { Selector } from "../selector/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
	import { getSelectorTriggerButtonVariant } from "../selector/selector-trigger-classes.js";
	import { Button } from "../button/index.js";
	import {
		getConfigOptionNextBooleanValue,
		getConfigOptionResolvedTriggerSize,
		getConfigOptionViewState,
		shouldEmitConfigOptionValueChange,
	} from "./agent-input-config-option-selector-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import * as Tooltip from "../tooltip/index.js";
	import AgentInputReasoningEffortTrigger from "./agent-input-reasoning-effort-trigger.svelte";
	import { SelectorItem } from "../selector/index.js";

	export type { AgentInputConfigOption };

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		triggerSize?: SelectorTriggerSize;
		embeddedInGroup?: boolean;
		onValueChange: (configId: string, value: string) => void;
	}

	let {
		configOption,
		disabled = false,
		triggerSize = "composerChipLabel",
		embeddedInGroup = false,
		onValueChange,
	}: Props = $props();

	const viewState = $derived(getConfigOptionViewState(configOption));
	const resolvedTriggerSize = $derived(
		getConfigOptionResolvedTriggerSize(configOption, triggerSize)
	);
	const selectorVariant = $derived(getSelectorTriggerButtonVariant(resolvedTriggerSize));

	function handleSelect(value: string) {
		if (
			shouldEmitConfigOptionValueChange({
				nextValue: value,
				currentValue: viewState.currentValue,
			})
		) {
			onValueChange(configOption.id, value);
		}
	}

	function handleBooleanToggle() {
		if (disabled) return;
		const nextValue = getConfigOptionNextBooleanValue(viewState.isBooleanEnabled);
		if (
			shouldEmitConfigOptionValueChange({
				nextValue,
				currentValue: viewState.currentValue,
			})
		) {
			onValueChange(configOption.id, nextValue);
		}
	}
</script>

{#snippet configOptionIcon()}
	{#if viewState.iconKind === "fast"}
		<RoundedIcon
			name="lightning"
			class={viewState.iconClass}
			style={viewState.iconStyle}
		/>
	{:else}
		<RoundedIcon name="shield-check" style="color: {viewState.iconColor}" />
	{/if}
{/snippet}

{#snippet configOptionDropdownRows()}
	<div class="max-h-[250px] overflow-y-auto scrollbar-thin">
		{#each configOption.options ?? [] as option (String(option.value))}
			{@const optValue = String(option.value)}
			<SelectorItem
				label={option.name}
				selected={optValue === viewState.currentValue}
				onSelect={() => handleSelect(optValue)}
			/>
		{/each}
	</div>
{/snippet}

{#snippet configOptionTooltipContent()}
	<Tooltip.Content side="top" class="max-w-[17rem] leading-relaxed font-normal">
		<span class="font-semibold text-foreground">{viewState.tooltipTitle}</span>
		{#if viewState.tooltipCurrentValueLabel != null}
			<span class="mt-1 block font-medium text-foreground">
				Currently: {viewState.tooltipCurrentValueLabel}
			</span>
		{/if}
		<span class="mt-1 block">{viewState.tooltipDescription}</span>
	</Tooltip.Content>
{/snippet}

{#if viewState.isBooleanConfigOption}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="secondary"
					size="icon-md"
					title={viewState.buttonTitle}
					aria-label={viewState.buttonTitle}
					data-testid="agent-input-fast-mode-button"
					{disabled}
					aria-pressed={viewState.isBooleanEnabled}
					onclick={handleBooleanToggle}
				>
					<RoundedIcon
						name="lightning"
						class={viewState.iconClass}
						style={viewState.iconStyle}
					/>
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		{@render configOptionTooltipContent()}
	</Tooltip.Root>
{:else if viewState.iconKind === "reasoning"}
	<AgentInputReasoningEffortTrigger
		{disabled}
		{embeddedInGroup}
		iconStyle={viewState.iconStyle}
		triggerAriaLabel={viewState.buttonTitle}
		tooltipTitle={viewState.tooltipTitle}
		tooltipDescription={viewState.tooltipDescription}
		tooltipSide="top"
		side="top"
	>
		{#snippet children()}
			{@render configOptionDropdownRows()}
		{/snippet}
	</AgentInputReasoningEffortTrigger>
{:else}
	<Selector
		{disabled}
		align="start"
		variant={selectorVariant}
		showChevron={false}
		triggerSize={resolvedTriggerSize}
		triggerAriaLabel={viewState.buttonTitle}
		tooltipTitle={viewState.tooltipTitle}
		tooltipDescription={viewState.tooltipDescription}
		tooltipSide="top"
		side="top"
		sideOffset={8}
	>
		{#snippet renderButton()}
			{@render configOptionIcon()}
		{/snippet}

		{@render configOptionDropdownRows()}
	</Selector>
{/if}
