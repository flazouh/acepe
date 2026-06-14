<!--
  AgentInputConfigOptionSelector - Toolbar button for a config option (fast mode, reasoning, etc).

  Extracted from packages/desktop/src/lib/acp/components/config-option-selector.svelte.
  Accepts a normalized config option shape; desktop still derives ConfigOptionData from session state.
-->
<script lang="ts">
	import { IconCircleCheckFilled } from "@tabler/icons-svelte";
	import { Brain, Lightning, ShieldCheck } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Selector } from "../selector/index.js";
	import {
		getConfigOptionNextBooleanValue,
		getConfigOptionViewState,
		shouldEmitConfigOptionValueChange,
	} from "./agent-input-config-option-selector-state.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	export type { AgentInputConfigOption };

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		onValueChange: (configId: string, value: string) => void;
	}

	let { configOption, disabled = false, onValueChange }: Props = $props();

	const viewState = $derived(getConfigOptionViewState(configOption));

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

{#if !viewState.isBooleanConfigOption}
	<Selector
		{disabled}
		align="start"
		variant="ghost"
		showChevron={false}
		triggerSize="square"
		triggerAriaLabel={viewState.buttonTitle}
	>
		{#snippet renderButton()}
			{#if viewState.iconKind === "reasoning"}
				<Brain class={viewState.iconClass} size={14} weight={viewState.iconWeight} style={viewState.iconStyle} />
			{:else if viewState.iconKind === "fast"}
				<Lightning class={viewState.iconClass} size={14} weight={viewState.iconWeight} style={viewState.iconStyle} />
			{:else}
				<ShieldCheck size={14} weight="fill" style="color: {viewState.iconColor}" />
			{/if}
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
{:else}
	<button
		type="button"
		{disabled}
		aria-pressed={viewState.isBooleanEnabled}
		onclick={handleBooleanToggle}
		title={viewState.buttonTitle}
		class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
			{disabled
			? 'text-muted-foreground/50 cursor-not-allowed'
			: viewState.isBooleanEnabled
				? 'bg-accent/60 text-foreground hover:bg-accent/80'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
	>
		{#if viewState.iconKind === "reasoning"}
			<Brain class={viewState.iconClass} size={14} weight={viewState.iconWeight} style={viewState.iconStyle} />
		{:else if viewState.iconKind === "fast"}
			<Lightning class={viewState.iconClass} size={14} weight={viewState.iconWeight} style={viewState.iconStyle} />
		{:else}
			<ShieldCheck size={14} weight="fill" style="color: {viewState.iconColor}" />
		{/if}
	</button>
{/if}
