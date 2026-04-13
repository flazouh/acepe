<script lang="ts">
import { BuildIcon, PlanIcon } from "@acepe/ui";
import { onDestroy, onMount } from "svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";
import { getSelectorRegistry } from "../logic/selector-registry.svelte.js";
import type { AvailableMode } from "../types/available-mode.js";
import { CanonicalModeId } from "../types/canonical-mode-id.js";
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

function modeColor(modeId: string): string {
	switch (modeId) {
		case CanonicalModeId.BUILD:
			return "var(--build-icon)";
		case CanonicalModeId.PLAN:
			return "var(--plan-icon)";
		default:
			return "var(--build-icon)";
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
				<BuildIcon size="sm" />
			</div>
		{:else}
			{#each [...availableModes].reverse() as mode, i (mode.id)}
				{@const color = modeColor(mode.id)}
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
								title={mode.id === CanonicalModeId.PLAN ? m.plan_heading() : m.plan_sidebar_build()}
								aria-label={mode.id === CanonicalModeId.PLAN ? m.plan_heading() : m.plan_sidebar_build()}
							>
								{#if mode.id === CanonicalModeId.PLAN}
									<PlanIcon
										size="sm"
										class="transition-colors duration-150"
										style={selected ? `color: ${color}` : undefined}
									/>
								{:else}
									<BuildIcon
										size="sm"
										class="transition-colors duration-150"
										style={selected ? `color: ${color}` : undefined}
									/>
								{/if}
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>
						{mode.id === CanonicalModeId.PLAN ? m.plan_heading() : m.plan_sidebar_build()}
					</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		{/if}
	</div>
