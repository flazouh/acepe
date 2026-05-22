<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconCircleCheckFilled } from "@tabler/icons-svelte";
import { Brain } from "phosphor-svelte";
import { Lightning } from "phosphor-svelte";
import { ShieldCheck } from "phosphor-svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { ConfigOptionData } from "../../services/converted-session-types.js";

import { Colors } from "@acepe/ui/colors";
import { resolveConfigOptionIconState } from "./config-option-selector-icon-state.js";
import {
	buildConfigOptionSelectorState,
	getNextBooleanConfigOptionValue,
} from "./config-option-selector-state.js";

interface ConfigOptionSelectorProps {
	configOption: ConfigOptionData;
	onValueChange: (configId: string, value: string) => Promise<void>;
	disabled?: boolean;
}

let { configOption, onValueChange, disabled = false }: ConfigOptionSelectorProps = $props();

const selectorState = $derived(buildConfigOptionSelectorState(configOption));
const currentValue = $derived(selectorState.currentValue);
const isBooleanConfigOption = $derived(selectorState.isBoolean);
const isBooleanEnabled = $derived(selectorState.isBooleanEnabled);
const isReasoningConfigOption = $derived(selectorState.kind === "reasoning");
const isFastConfigOption = $derived(selectorState.kind === "fast");
const currentValueLabel = $derived(selectorState.currentValueLabel);

const iconColor = $derived.by(() => {
	if (isFastConfigOption) {
		return Colors.yellow;
	}

	if (isReasoningConfigOption) {
		return Colors.purple;
	}

	return Colors.cyan;
});

const iconState = $derived.by(() =>
	resolveConfigOptionIconState({
		isFastOption: isFastConfigOption,
		isBooleanOption: isBooleanConfigOption,
		isBooleanEnabled,
		currentValue,
	})
);
const iconClass = $derived(iconState.useMutedForeground ? "text-muted-foreground" : "");
const iconStyle = $derived.by(() => {
	if (iconState.useMutedForeground) {
		return "";
	}

	return `color: ${iconColor}`;
});

function handleSelect(value: string) {
	if (value !== currentValue) {
		// Fire-and-forget: optimistic update handles UI, rollback handles errors
		void onValueChange(configOption.id, value);
	}
}

function handleBooleanToggle() {
	if (disabled) {
		return;
	}

	const nextValue = getNextBooleanConfigOptionValue(isBooleanEnabled);
	if (nextValue !== currentValue) {
		void onValueChange(configOption.id, nextValue);
	}
}
</script>

{#if !isBooleanConfigOption}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger {disabled}>
			{#snippet child({ props })}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<button
							{...props}
							type="button"
							{disabled}
							class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
								{disabled
								? 'text-muted-foreground/50 cursor-not-allowed'
								: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
						>
							{#if isReasoningConfigOption}
								<Brain
									class={iconClass}
									size={14}
									weight={iconState.weight}
									style={iconStyle}
								/>
							{:else if isFastConfigOption}
								<Lightning
									class={iconClass}
									size={14}
									weight={iconState.weight}
									style={iconStyle}
								/>
							{:else}
								<ShieldCheck size={14} weight="fill" style="color: {iconColor}" />
							{/if}
						</button>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{configOption.name}: {currentValueLabel}
					</Tooltip.Content>
				</Tooltip.Root>
			{/snippet}
		</DropdownMenu.Trigger>

		<DropdownMenu.Content
			align="start"
			sideOffset={4}
			class="w-fit max-w-[280px] max-h-[250px] overflow-y-auto scrollbar-thin"
		>
			{#each configOption.options ? configOption.options : [] as option (String(option.value))}
				{@const optValue = String(option.value)}
				{@const isSelected = optValue === currentValue}
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
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{:else}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<button
				type="button"
				{disabled}
				aria-pressed={isBooleanEnabled}
				onclick={handleBooleanToggle}
				class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
					{disabled
					? 'text-muted-foreground/50 cursor-not-allowed'
					: isBooleanEnabled
						? 'bg-accent/60 text-foreground hover:bg-accent/80'
						: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
			>
				{#if isReasoningConfigOption}
					<Brain
						class={iconClass}
						size={14}
						weight={iconState.weight}
						style={iconStyle}
					/>
				{:else if isFastConfigOption}
					<Lightning
						class={iconClass}
						size={14}
						weight={iconState.weight}
						style={iconStyle}
					/>
				{:else}
					<ShieldCheck size={14} weight="fill" style="color: {iconColor}" />
				{/if}
			</button>
		</Tooltip.Trigger>
		<Tooltip.Content>
			{configOption.name}: {currentValueLabel}
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
