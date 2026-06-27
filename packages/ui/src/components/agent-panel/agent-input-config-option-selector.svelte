<!--
  AgentInputConfigOptionSelector - Toolbar button for a config option (fast mode, reasoning, etc).

  Accepts a normalized config option shape; desktop derives AgentInputConfigOption from session state.
-->
<script lang="ts">
	import { Lightning, ShieldCheck } from "phosphor-svelte";

	import { EmbeddedIconButton } from "../panel-header/index.js";
	import { Selector } from "../selector/index.js";
	import type { SelectorTriggerSize } from "../selector/selector-trigger-classes.js";
	import * as Tooltip from "../tooltip/index.js";
	import AgentInputReasoningEffortTrigger from "./agent-input-reasoning-effort-trigger.svelte";
	import AgentInputSelectorItemRow from "./agent-input-selector-item-row.svelte";
	import {
		getConfigOptionFastTriggerClass,
		getConfigOptionNextBooleanValue,
		getConfigOptionResolvedTriggerSize,
		getConfigOptionViewState,
		shouldEmitConfigOptionValueChange,
	} from "./agent-input-config-option-selector-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	export type { AgentInputConfigOption };

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		triggerSize?: SelectorTriggerSize;
		onValueChange: (configId: string, value: string) => void;
	}

	let {
		configOption,
		disabled = false,
		triggerSize = "setupChip",
		onValueChange,
	}: Props = $props();

	const viewState = $derived(getConfigOptionViewState(configOption));
	const resolvedTriggerSize = $derived(
		getConfigOptionResolvedTriggerSize(configOption, triggerSize)
	);
	const selectorVariant = $derived(
		resolvedTriggerSize === "setupChip" || resolvedTriggerSize === "setupChipIcon"
			? "ghost"
			: "chromeIcon"
	);
	const fastTriggerClass = $derived(
		getConfigOptionFastTriggerClass({
			disabled,
			isEnabled: viewState.isBooleanEnabled,
		})
	);

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
		<Lightning class="{viewState.iconClass} size-3.5" weight={viewState.iconWeight} style={viewState.iconStyle} />
	{:else}
		<ShieldCheck class="size-3.5" weight="fill" style="color: {viewState.iconColor}" />
	{/if}
{/snippet}

{#snippet configOptionDropdownRows()}
	<div class="max-h-[250px] overflow-y-auto scrollbar-thin">
		{#each configOption.options ?? [] as option (String(option.value))}
			{@const optValue = String(option.value)}
			<AgentInputSelectorItemRow
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
				<EmbeddedIconButton
					{...props}
					title={viewState.buttonTitle}
					ariaLabel={viewState.buttonTitle}
					active={viewState.isBooleanEnabled}
					disabled={disabled}
					class={fastTriggerClass}
					aria-pressed={viewState.isBooleanEnabled}
					onclick={handleBooleanToggle}
				>
					{#snippet children()}
						<Lightning
							class={viewState.iconClass}
							size={12}
							weight={viewState.iconWeight}
							style={viewState.iconStyle}
						/>
					{/snippet}
				</EmbeddedIconButton>
			{/snippet}
		</Tooltip.Trigger>
		{@render configOptionTooltipContent()}
	</Tooltip.Root>
{:else if viewState.iconKind === "reasoning"}
	<AgentInputReasoningEffortTrigger
		{disabled}
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
