<script lang="ts">
import IconRotateClockwise from "@tabler/icons-svelte/icons/rotate-clockwise";
import IconSearch from "@tabler/icons-svelte/icons/search";
import { SvelteMap } from "svelte/reactivity";
import { createLogger } from "$lib/acp/utils/logger.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import type { Action, Keybinding } from "$lib/keybindings/types.js";
import { formatKeyStringToArray } from "$lib/keybindings/utils/formatter.js";
import * as m from "$lib/paraglide/messages.js";
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

<div class="flex flex-col h-full gap-2 text-sm">
	<!-- Header -->
	<div class="flex items-center justify-between shrink-0">
		<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
			{m.settings_keybindings()}
		</h2>
		<button
			type="button"
			class="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
			onclick={handleResetAllToDefaults}
			disabled={isLoading}
		>
			<IconRotateClockwise class="size-3" />
			{m.settings_keybindings_reset_all()}
		</button>
	</div>

	<!-- Search -->
	<div class="relative shrink-0">
		<IconSearch class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
		<input
			type="text"
			placeholder={m.settings_keybindings_search()}
			bind:value={searchQuery}
			class="w-full h-7 pl-7 pr-2 text-sm bg-muted/30 border border-border/30 rounded-md outline-none placeholder:text-muted-foreground/40 focus:border-border/60 transition-colors"
		/>
	</div>

	<!-- List -->
	<div class="flex-1 min-h-0 overflow-auto rounded-lg border border-border/30">
		{#each groupedActions as [category, actions] (category)}
			<div
				class="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 bg-muted/20 border-b border-border/20 sticky top-0"
			>
				{category}
			</div>
			{#each actions as action (action.id)}
				{@const binding = getBinding(action.id)}
				{@const isCustom = kb.hasUserKeybinding(action.id)}
				{@const isEditing = editingActionId === action.id}
				<div
					class={cn(
						"flex items-center gap-2 px-2 py-1.5 border-b border-border/10 last:border-b-0",
						"hover:bg-muted/30 transition-colors group"
					)}
				>
					<!-- Action label -->
					<span class="flex-1 font-medium text-foreground/80 truncate">
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
								<span class="text-xs text-muted-foreground/40">
									{m.settings_keybindings_not_bound()}
								</span>
							{/if}
							<button
								type="button"
								class="size-5 flex items-center justify-center rounded-sm text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 opacity-0 group-hover:opacity-100 transition-all"
								onclick={() => (editingActionId = action.id)}
								disabled={isLoading}
								title={m.settings_keybindings_edit()}
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
									class="size-5 flex items-center justify-center rounded-sm text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
									onclick={() => handleReset(action.id)}
									disabled={isLoading}
									title={m.settings_keybindings_reset()}
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
