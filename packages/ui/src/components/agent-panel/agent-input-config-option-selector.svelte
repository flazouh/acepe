<!--
  AgentInputConfigOptionSelector - Toolbar button for a config option (fast mode, reasoning, etc).

  Extracted from packages/desktop/src/lib/acp/components/config-option-selector.svelte.
  Accepts a normalized config option shape; desktop still derives ConfigOptionData from session state.
-->
<script lang="ts">
	import { IconCircleCheckFilled } from "@tabler/icons-svelte";
	import { Brain, Lightning, ShieldCheck } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Colors } from "../../lib/colors.js";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

	export type { AgentInputConfigOption };

	interface Props {
		configOption: AgentInputConfigOption;
		disabled?: boolean;
		onValueChange: (configId: string, value: string) => void;
	}

	let { configOption, disabled = false, onValueChange }: Props = $props();

	function includesNormalizedFragment(value: string, fragment: string): boolean {
		return value.toLowerCase().includes(fragment);
	}

	function isBooleanOption(opt: AgentInputConfigOption): boolean {
		if (opt.type === "boolean") return true;
		if (typeof opt.currentValue === "boolean") return true;
		if (typeof opt.currentValue !== "string") return false;
		const normalized = opt.currentValue.toLowerCase();
		return normalized === "true" || normalized === "false";
	}

	function isReasoningOption(opt: AgentInputConfigOption): boolean {
		return (
			includesNormalizedFragment(opt.category, "thought") ||
			includesNormalizedFragment(opt.category, "reason") ||
			includesNormalizedFragment(opt.id, "thought") ||
			includesNormalizedFragment(opt.id, "reason") ||
			includesNormalizedFragment(opt.name, "reason")
		);
	}

	function isFastOption(opt: AgentInputConfigOption): boolean {
		return (
			includesNormalizedFragment(opt.category, "fast") ||
			includesNormalizedFragment(opt.category, "tier") ||
			includesNormalizedFragment(opt.id, "fast") ||
			includesNormalizedFragment(opt.id, "tier") ||
			includesNormalizedFragment(opt.name, "fast") ||
			includesNormalizedFragment(opt.name, "tier")
		);
	}

	const currentValue = $derived(
		configOption.currentValue != null ? String(configOption.currentValue) : null
	);

	const isBooleanConfigOption = $derived(isBooleanOption(configOption));

	const isBooleanEnabled = $derived.by(() => {
		if (!isBooleanConfigOption || currentValue == null) return false;
		const normalized = currentValue.toLowerCase();
		return normalized === "true" || normalized === "on" || normalized === "enabled";
	});

	const isReasoningConfigOption = $derived(isReasoningOption(configOption));
	const isFastConfigOption = $derived(isFastOption(configOption));

	const currentValueLabel = $derived.by(() => {
		const options = configOption.options;
		if (options && currentValue != null) {
			return options.find((opt) => String(opt.value) === currentValue)?.name ?? currentValue;
		}
		if (isBooleanConfigOption) return isBooleanEnabled ? "On" : "Off";
		if (currentValue != null) return currentValue;
		return configOption.name;
	});

	const iconColor = $derived.by(() => {
		if (isFastConfigOption) return Colors.yellow;
		if (isReasoningConfigOption) return Colors.purple;
		return Colors.cyan;
	});

	const iconWeight = $derived.by<"fill" | "regular">(() => {
		if (!isFastConfigOption) return "fill";
		if (isBooleanConfigOption && isBooleanEnabled) return "fill";
		if (!isBooleanConfigOption && currentValue) {
			const normalized = currentValue.toLowerCase();
			if (normalized === "fast" || normalized === "true" || normalized === "on" || normalized === "enabled") return "fill";
		}
		return "regular";
	});

	const useMuted = $derived(isFastConfigOption && iconWeight === "regular");
	const iconClass = $derived(useMuted ? "text-muted-foreground" : "");
	const iconStyle = $derived(useMuted ? "" : `color: ${iconColor}`);

	const buttonTitle = $derived(`${configOption.name}: ${currentValueLabel}`);

	function handleSelect(value: string) {
		if (value !== currentValue) {
			onValueChange(configOption.id, value);
		}
	}

	function handleBooleanToggle() {
		if (disabled) return;
		const nextValue = isBooleanEnabled ? "false" : "true";
		if (nextValue !== currentValue) {
			onValueChange(configOption.id, nextValue);
		}
	}
</script>

{#if !isBooleanConfigOption}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger {disabled}>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					{disabled}
					title={buttonTitle}
					class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
						{disabled
						? 'text-muted-foreground/50 cursor-not-allowed'
						: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
				>
					{#if isReasoningConfigOption}
						<Brain class={iconClass} size={14} weight={iconWeight} style={iconStyle} />
					{:else if isFastConfigOption}
						<Lightning class={iconClass} size={14} weight={iconWeight} style={iconStyle} />
					{:else}
						<ShieldCheck size={14} weight="fill" style="color: {iconColor}" />
					{/if}
				</button>
			{/snippet}
		</DropdownMenu.Trigger>

		<DropdownMenu.Content
			align="start"
			sideOffset={4}
			class="w-fit max-w-[280px] max-h-[250px] overflow-y-auto scrollbar-thin"
		>
			{#each configOption.options ?? [] as option (String(option.value))}
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
	<button
		type="button"
		{disabled}
		aria-pressed={isBooleanEnabled}
		onclick={handleBooleanToggle}
		title={buttonTitle}
		class="flex items-center justify-center w-7 h-7 transition-colors rounded-none
			{disabled
			? 'text-muted-foreground/50 cursor-not-allowed'
			: isBooleanEnabled
				? 'bg-accent/60 text-foreground hover:bg-accent/80'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
	>
		{#if isReasoningConfigOption}
			<Brain class={iconClass} size={14} weight={iconWeight} style={iconStyle} />
		{:else if isFastConfigOption}
			<Lightning class={iconClass} size={14} weight={iconWeight} style={iconStyle} />
		{:else}
			<ShieldCheck size={14} weight="fill" style="color: {iconColor}" />
		{/if}
	</button>
{/if}
