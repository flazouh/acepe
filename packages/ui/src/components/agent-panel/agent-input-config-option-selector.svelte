<!--
  AgentInputConfigOptionSelector - Toolbar button for a config option (fast mode, reasoning, etc).

  Extracted from packages/desktop/src/lib/acp/components/config-option-selector.svelte.
  Accepts a normalized config option shape; desktop still derives ConfigOptionData from session state.
-->
<script lang="ts">
	import { IconCircleCheckFilled } from "@tabler/icons-svelte";
	import { Lightning, ShieldCheck } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Button } from "../button/index.js";
	import { EmbeddedIconButton } from "../panel-header/index.js";
	import { Selector } from "../selector/index.js";
	import * as Tooltip from "../tooltip/index.js";
	import { VoiceDownloadProgress } from "../voice-download-progress/index.js";
	import {
		getConfigOptionFastTriggerClass,
		getConfigOptionNextBooleanValue,
		getConfigOptionReasoningBarOnlyTriggerClass,
		getConfigOptionReasoningTriggerClass,
		getConfigOptionViewState,
		getReasoningEffortNextValue,
		isReasoningConfigOption,
		shouldEmitConfigOptionValueChange,
	} from "./agent-input-config-option-selector-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	export type { AgentInputConfigOption };

	type ConfigOptionDisplayMode = "default" | "barOnly";

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		displayMode?: ConfigOptionDisplayMode;
		onValueChange: (configId: string, value: string) => void;
	}

	let {
		configOption,
		disabled = false,
		displayMode = "default",
		onValueChange,
	}: Props = $props();

	const viewState = $derived(getConfigOptionViewState(configOption));
	const isReasoningOption = $derived(isReasoningConfigOption(configOption));
	const reasoningTriggerClass = $derived(
		displayMode === "barOnly"
			? getConfigOptionReasoningBarOnlyTriggerClass()
			: getConfigOptionReasoningTriggerClass()
	);
	const showReasoningLabel = $derived(displayMode !== "barOnly");
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

	function handleReasoningCycle() {
		if (disabled) return;
		const nextValue = getReasoningEffortNextValue({
			configOption,
			currentValue: viewState.currentValue,
		});
		if (
			nextValue != null &&
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
		<Lightning class={viewState.iconClass} size={14} weight={viewState.iconWeight} style={viewState.iconStyle} />
	{:else}
		<ShieldCheck size={14} weight="fill" style="color: {viewState.iconColor}" />
	{/if}
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

{#if isReasoningOption}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size={displayMode === "barOnly" ? "2xs" : "sm"}
					{disabled}
					class={reasoningTriggerClass}
					data-testid={displayMode === "barOnly" ? "setup-bar-reasoning" : undefined}
					aria-label={viewState.buttonTitle}
					onclick={handleReasoningCycle}
				>
					{#if showReasoningLabel}
						<span class="max-w-16 font-medium leading-none">
							{viewState.currentValueLabel}
						</span>
					{/if}
					{#if viewState.reasoningBarSegmentCount > 0}
						<VoiceDownloadProgress
							ariaLabel={viewState.buttonTitle}
							decorative={true}
							filledSegmentCount={viewState.reasoningBarFilledSegmentCount}
							label=""
							percent={viewState.reasoningBarPercent}
							segmentCount={viewState.reasoningBarSegmentCount}
							showPercent={false}
							variant={displayMode === "barOnly" ? "setupReasoningBar" : "reasoningDiscrete"}
						/>
					{/if}
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		{@render configOptionTooltipContent()}
	</Tooltip.Root>
{:else if viewState.isBooleanConfigOption}
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
{:else}
	<Selector
		{disabled}
		align="start"
		variant="ghost"
		showChevron={false}
		triggerSize="square"
		triggerAriaLabel={viewState.buttonTitle}
		tooltipTitle={viewState.tooltipTitle}
		tooltipDescription={viewState.tooltipDescription}
		tooltipSide="top"
	>
		{#snippet renderButton()}
			{@render configOptionIcon()}
		{/snippet}

		{#each configOption.options ?? [] as option (String(option.value))}
			{@const optValue = String(option.value)}
			{@const isSelected = optValue === viewState.currentValue}
			<DropdownMenu.Item
				onSelect={() => handleSelect(optValue)}
				class="group/item py-1 {isSelected ? 'bg-accent' : ''}"
			>
				<div class="flex items-center gap-3 w-full">
					<span class="flex-1 text-sm truncate">{option.name}</span>
					{#if isSelected}
						<IconCircleCheckFilled class="h-4 w-4 shrink-0 text-foreground" />
					{/if}
				</div>
			</DropdownMenu.Item>
		{/each}
	</Selector>
{/if}
