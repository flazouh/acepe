<script lang="ts">
import { IconRotateClockwise } from "@tabler/icons-svelte";
import { IconSearch } from "@tabler/icons-svelte";
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

// Group actions by category
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

<div class="flex flex-col h-full gap-2 text-[13px]">
	<!-- Header -->
	<div class="flex items-center justify-between shrink-0">
		<h2 class="text-[13px] font-semibold text-foreground">
			{"Keybindings"}
		</h2>
		<button
			type="button"
			class="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
			onclick={handleResetAllToDefaults}
			disabled={isLoading}
		>
			<IconRotateClockwise class="size-3" />
			{"Reset All"}
		</button>
	</div>

	<!-- Search -->
	<div class="relative shrink-0">
		<IconSearch class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
		<input
			type="text"
			placeholder={"Search keybindings..."}
			bind:value={searchQuery}
			class="w-full h-7 pl-7 pr-2 text-[13px] bg-muted/20 border border-border/60 rounded-md outline-none placeholder:text-muted-foreground/40 focus:border-border transition-colors"
		/>
	</div>

	<!-- List -->
	<div class="flex-1 min-h-0 overflow-auto rounded-lg bg-muted/20 shadow-sm">
		{#each groupedActions as [category, actions] (category)}
			<div
				class="px-3 h-8 flex items-center text-[12px] font-semibold text-muted-foreground bg-muted/20 border-b border-border/40 sticky top-0"
			>
				{category}
			</div>
			{#each actions as action (action.id)}
				{@const binding = getBinding(action.id)}
				{@const isCustom = kb.hasUserKeybinding(action.id)}
				{@const isEditing = editingActionId === action.id}
				<div
					class={cn(
						"flex items-center gap-2 px-3 h-8 border-t border-border/40",
						"hover:bg-muted/30 transition-colors group"
					)}
				>
					<!-- Action label -->
					<span class="flex-1 text-[13px] font-medium text-foreground truncate">
						{action.label}
					</span>

					<!-- Keybinding cell -->
					{#if isEditing}
						<KeybindingEditor
							actionId={action.id}
							onSave={(key) => handleSaveKeybinding(action.id, key)}
							onCancel={() => (editingActionId = null)}
						/>
					{:else}
						<div class="flex items-center gap-1.5 shrink-0">
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
								class="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-all"
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
									class="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
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
			<div class="py-8 text-center text-muted-foreground/40 text-sm">No keybindings found</div>
		{/if}
	</div>
</div>
