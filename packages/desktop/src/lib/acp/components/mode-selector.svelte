<script lang="ts">
import { RoundedIcon } from "@acepe/ui";
import { onDestroy, onMount } from "svelte";
import * as Tooltip from "@acepe/ui/tooltip";
import { getSelectorRegistry } from "../logic/selector-registry.svelte.js";
import type { AvailableMode } from "../types/available-mode.js";
import type { ModeId } from "../types/mode-id.js";
interface ModeSelectorProps {
	availableModes: readonly AvailableMode[];
	currentModeId: ModeId | null;
	onModeChange: (modeId: ModeId) => Promise<void>;
	panelId?: string;
	ontoggle?: (isOpen: boolean) => void;
}

let { availableModes, currentModeId, onModeChange, panelId, ontoggle }: ModeSelectorProps =
	$props();

const registry = getSelectorRegistry();
let unregister: (() => void) | null = null;

onMount(() => {
	if (registry && panelId) {
		unregister = registry.register("mode", panelId, { toggle, cycle });
	}
});

onDestroy(() => {
	unregister?.();
});

export function toggle() {
	ontoggle?.(false);
}

export function cycle() {
	if (availableModes.length === 0) {
		return;
	}
	const currentIndex = availableModes.findIndex((m) => m.id === currentModeId);
	const nextIndex =
		currentIndex === -1 ? 1 % availableModes.length : (currentIndex + 1) % availableModes.length;
	const nextMode = availableModes[nextIndex];
	if (nextMode.id !== currentModeId) {
		onModeChange(nextMode.id);
	}
}

async function handleModeChange(modeId: ModeId) {
	if (modeId !== currentModeId) {
		await onModeChange(modeId);
	}
}

function isSelected(modeId: string): boolean {
	return modeId === currentModeId;
}
</script>

	<div role="group" class="flex h-7 w-fit items-stretch">
		{#if availableModes.length === 0}
			<div class="flex items-center justify-center w-7">
				<RoundedIcon name="sliders" class="size-3.5" />
			</div>
		{:else}
			{#each [...availableModes].reverse() as mode, i (mode.id)}
				{@const selected = isSelected(mode.id)}
				{#if i > 0}
					<div class="w-px self-stretch bg-border/50"></div>
				{/if}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								onclick={() => handleModeChange(mode.id)}
								class="flex items-center justify-center w-7 text-[11px] font-medium transition-colors rounded-none
									{selected
									? 'bg-accent text-foreground'
									: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
								title={mode.name}
								aria-label={mode.name}
							>
								<RoundedIcon name="sliders" class="size-3.5 transition-colors duration-150" />
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>
						{mode.name}
					</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		{/if}
	</div>
