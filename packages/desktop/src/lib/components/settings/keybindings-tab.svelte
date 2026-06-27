<script lang="ts">
import { IconRotateClockwise } from "@acepe/ui/icons";
import { IconSearch } from "@acepe/ui/icons";
import { SvelteMap } from "svelte/reactivity";
import { createLogger } from "$lib/acp/utils/logger.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import type { Action, Keybinding } from "$lib/keybindings/types.js";
import { formatKeyStringToArray } from "$lib/keybindings/utils/formatter.js";
import { saveCustomKeybindings } from "$lib/services/settings.svelte.js";
import { cn } from "$lib/utils.js";

import KeybindingEditor from "./keybinding-editor.svelte";

const logger = createLogger({ id: "keybindings", name: "Keybindings" });
const kb = getKeybindingsService();

let searchQuery = $state("");
let editingActionId = $state<string | null>(null);
let isLoading = $state(false);

const allActions = $derived(kb.getAllActions());
const allKeybindings = $derived(kb.getAllKeybindings());

const filteredActions = $derived.by(() => {
	if (!searchQuery.trim()) return allActions;
	const query = searchQuery.toLowerCase();
	return allActions.filter(
		(action) =>
			action.label.toLowerCase().includes(query) ||
			action.id.toLowerCase().includes(query) ||
			action.description?.toLowerCase().includes(query)
	);
});

const groupedActions = $derived.by(() => {
	const grouped = new SvelteMap<string, Action[]>();
	for (const action of filteredActions) {
		if (!grouped.has(action.category)) grouped.set(action.category, []);
		grouped.get(action.category)?.push(action);
	}
	return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
});

function getBinding(actionId: string): Keybinding | undefined {
	return allKeybindings.find((kb) => kb.command === actionId);
}

async function handleSaveKeybinding(actionId: string, key: string) {
	isLoading = true;
	const result = await kb.saveUserKeybinding({ key, command: actionId, source: "user" });
	result.mapErr((e) => logger.error("Failed to save keybinding:", e));
	editingActionId = null;
	isLoading = false;
}

async function handleReset(actionId: string) {
	if (!kb.hasUserKeybinding(actionId)) return;
	isLoading = true;
	const result = await kb.deleteUserKeybinding(actionId);
	result.mapErr((e) => logger.error("Failed to reset keybinding:", e));
	isLoading = false;
}

async function handleResetAllToDefaults() {
	if (!confirm("Reset all keybindings to defaults? This will remove all custom keybindings."))
		return;
	isLoading = true;
	const result = await saveCustomKeybindings({});
	result.mapErr((e) => logger.error("Failed to reset keybindings:", e));
	await kb.loadUserKeybindings();
	if (kb.isInstalled() && typeof window !== "undefined") kb.reinstall();
	isLoading = false;
}
</script>

<div class="flex h-full min-h-0 flex-col gap-3 text-[13px]">
	<div class="flex shrink-0 items-center justify-end">
		<button
			type="button"
			class="flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
			onclick={handleResetAllToDefaults}
			disabled={isLoading}
		>
			<IconRotateClockwise class="size-3" />
			{"Reset All"}
		</button>
	</div>

	<div class="relative shrink-0 border-b border-border/30 pb-2">
		<IconSearch class="absolute left-0 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
		<input
			type="text"
			placeholder={"Search keybindings..."}
			bind:value={searchQuery}
			class="h-7 w-full border-0 bg-transparent pl-5 pr-2 text-[13px] outline-none placeholder:text-muted-foreground/40"
		/>
	</div>

	<div class="min-h-0 flex-1 overflow-auto">
		{#each groupedActions as [category, actions] (category)}
			<div
				class="sticky top-0 flex h-8 items-center border-b border-border/30 bg-popover text-[12px] font-medium text-muted-foreground"
			>
				{category}
			</div>
			{#each actions as action (action.id)}
				{@const binding = getBinding(action.id)}
				{@const isCustom = kb.hasUserKeybinding(action.id)}
				{@const isEditing = editingActionId === action.id}
				<div
					class={cn(
						"group flex h-8 items-center gap-2 border-b border-border/30 transition-colors hover:bg-accent/40"
					)}
				>
					<span class="flex-1 truncate text-[13px] font-medium text-foreground">
						{action.label}
					</span>

					{#if isEditing}
						<KeybindingEditor
							actionId={action.id}
							onSave={(key) => handleSaveKeybinding(action.id, key)}
							onCancel={() => (editingActionId = null)}
						/>
					{:else}
						<div class="flex shrink-0 items-center gap-1.5">
							{#if binding}
								<KbdGroup>
									{#each formatKeyStringToArray(binding.key) as key, index (key + index)}
										<Kbd>{key}</Kbd>
									{/each}
								</KbdGroup>
							{:else}
								<span class="text-[12px] text-muted-foreground/40">
									{"Not bound"}
								</span>
							{/if}
							<button
								type="button"
								class="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100"
								onclick={() => (editingActionId = action.id)}
								disabled={isLoading}
								title={"Edit keybinding"}
							>
								<svg
									class="size-2.5"
									viewBox="0 0 12 12"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
								>
									<path d="M8.5 1.5l2 2M1 11l.7-2.8L9.2 .7l2 2L3.8 10.2z" />
								</svg>
							</button>
							{#if isCustom}
								<button
									type="button"
									class="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
									onclick={() => handleReset(action.id)}
									disabled={isLoading}
									title={"Reset to default"}
								>
									<svg
										class="size-2.5"
										viewBox="0 0 12 12"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
									>
										<path d="M2 2l8 8M10 2l-8 8" />
									</svg>
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/each}
		{#if groupedActions.length === 0}
			<div class="py-8 text-center text-sm text-muted-foreground/40">No keybindings found</div>
		{/if}
	</div>
</div>
