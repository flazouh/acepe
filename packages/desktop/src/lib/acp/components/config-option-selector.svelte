<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import IconCircleCheckFilled from "@tabler/icons-svelte/icons/circle-check-filled";
import Lightning from "phosphor-svelte/lib/Lightning";
import ShieldCheck from "phosphor-svelte/lib/ShieldCheck";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { ConfigOptionData } from "../../services/converted-session-types.js";

import { Colors } from "../utils/colors.js";

interface ConfigOptionSelectorProps {
	configOption: ConfigOptionData;
	onValueChange: (configId: string, value: string) => Promise<void>;
	disabled?: boolean;
}

let { configOption, onValueChange, disabled = false }: ConfigOptionSelectorProps = $props();

// Normalize currentValue to string once for all comparisons
const currentValue = $derived(
	configOption.currentValue != null ? String(configOption.currentValue) : null
);

const currentValueLabel = $derived.by(() => {
	const options = configOption.options;
	if (!options || currentValue == null) return configOption.name;
	return options.find((opt) => String(opt.value) === currentValue)?.name ?? currentValue;
});

const iconColor = $derived.by(() => {
	switch (configOption.category) {
		case "mode":
			return Colors.cyan;
		case "thought_level":
			return Colors.purple;
		default:
			return Colors.cyan;
	}
});

function handleSelect(value: string) {
	if (value !== currentValue) {
		// Fire-and-forget: optimistic update handles UI, rollback handles errors
		void onValueChange(configOption.id, value);
	}
}
</script>

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
						{#if configOption.category === "thought_level"}
							<Lightning size={14} weight="fill" style="color: {iconColor}" />
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
