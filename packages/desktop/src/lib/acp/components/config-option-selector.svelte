<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconCircleCheckFilled } from "@tabler/icons-svelte";
import { Brain } from "phosphor-svelte";
import { Lightning } from "phosphor-svelte";
import { ShieldCheck } from "phosphor-svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { ConfigOptionData } from "../../services/converted-session-types.js";

import { Colors } from "../utils/colors.js";
import { resolveConfigOptionIconState } from "./config-option-selector-icon-state.js";

interface ConfigOptionSelectorProps {
	configOption: ConfigOptionData;
	onValueChange: (configId: string, value: string) => Promise<void>;
	disabled?: boolean;
}

let { configOption, onValueChange, disabled = false }: ConfigOptionSelectorProps = $props();

function includesNormalizedFragment(value: string, fragment: string): boolean {
	return value.toLowerCase().includes(fragment);
}

function isBooleanOption(configOption: ConfigOptionData): boolean {
	if (configOption.type === "boolean") {
		return true;
	}

	if (typeof configOption.currentValue === "boolean") {
		return true;
	}

	if (typeof configOption.currentValue !== "string") {
		return false;
	}

	const normalizedValue = configOption.currentValue.toLowerCase();
	return normalizedValue === "true" || normalizedValue === "false";
}

function isReasoningOption(configOption: ConfigOptionData): boolean {
	return (
		includesNormalizedFragment(configOption.category, "thought") ||
		includesNormalizedFragment(configOption.category, "reason") ||
		includesNormalizedFragment(configOption.id, "thought") ||
		includesNormalizedFragment(configOption.id, "reason") ||
		includesNormalizedFragment(configOption.name, "reason")
	);
}

function isFastOption(configOption: ConfigOptionData): boolean {
	return (
		includesNormalizedFragment(configOption.category, "fast") ||
		includesNormalizedFragment(configOption.category, "tier") ||
		includesNormalizedFragment(configOption.id, "fast") ||
		includesNormalizedFragment(configOption.id, "tier") ||
		includesNormalizedFragment(configOption.name, "fast") ||
		includesNormalizedFragment(configOption.name, "tier")
	);
}

// Normalize currentValue to string once for all comparisons
const currentValue = $derived(
	configOption.currentValue != null ? String(configOption.currentValue) : null
);

const isBooleanConfigOption = $derived(isBooleanOption(configOption));

const isBooleanEnabled = $derived.by(() => {
	if (!isBooleanConfigOption || currentValue == null) {
		return false;
	}

	const normalizedValue = currentValue.toLowerCase();
	return normalizedValue === "true" || normalizedValue === "on" || normalizedValue === "enabled";
});

const isReasoningConfigOption = $derived(isReasoningOption(configOption));
const isFastConfigOption = $derived(isFastOption(configOption));

const currentValueLabel = $derived.by(() => {
	const options = configOption.options;
	if (options && currentValue != null) {
		return options.find((opt) => String(opt.value) === currentValue)?.name ?? currentValue;
	}

	if (isBooleanConfigOption) {
		return isBooleanEnabled ? "On" : "Off";
	}

	if (currentValue != null) {
		return currentValue;
	}

	return configOption.name;
});

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

	const nextValue = isBooleanEnabled ? "false" : "true";
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
