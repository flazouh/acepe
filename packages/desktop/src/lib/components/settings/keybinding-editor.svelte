<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Kbd, KbdGroup } from "@acepe/ui/kbd";
import { getKeybindingsService } from "$lib/keybindings/index.js";
import {
	formatKeyStringToArray,
	keyboardEventToKeyString,
} from "$lib/keybindings/utils/formatter.js";
import * as m from "$lib/paraglide/messages.js";

let {
	actionId,
	onSave,
	onCancel,
}: {
	actionId: string;
	onSave: (key: string) => void;
	onCancel: () => void;
} = $props();

let isRecording = $state(true);
let newKey = $state<string | null>(null);
let error = $state<string | null>(null);

const kb = getKeybindingsService();

function handleKeyDown(event: KeyboardEvent) {
	if (!isRecording) return;

	// Handle Escape to cancel
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		handleCancel();
		return;
	}

	// Handle Enter to save if we have a new key
	if (event.key === "Enter" && newKey && !error) {
		event.preventDefault();
		event.stopPropagation();
		handleSave();
		return;
	}

	// Ignore modifier-only keypresses
	const isModifierOnly = ["Control", "Meta", "Shift", "Alt", "AltGraph"].includes(event.key);
	if (isModifierOnly) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();

	const keyString = keyboardEventToKeyString(event);
	if (keyString) {
		const parts = keyString.split("+");
		const validModifiers = ["$mod", "Shift", "Alt", "Control", "Meta"];
		const hasNonModifier = parts.some((part) => !validModifiers.includes(part));

		if (!hasNonModifier) {
			return;
		}

		newKey = keyString;
		isRecording = false;

		const existingBindings = kb
			.getAllKeybindings()
			.filter((b) => b.key === keyString && b.command !== actionId);

		if (existingBindings.length > 0) {
			const conflictLabels = existingBindings.map((b) => {
				const action = kb.getAllActions().find((a) => a.id === b.command);
				return action?.label || b.command;
			});
			error = m.settings_keybindings_used_by({ actions: conflictLabels.join(", ") });
		} else {
			error = null;
			handleSave();
		}
	}
}

function handleSave() {
	if (newKey && !error) {
		onSave(newKey);
	}
}

function handleCancel() {
	isRecording = false;
	newKey = null;
	error = null;
	onCancel();
}

onMount(() => {
	if (typeof window !== "undefined") {
		window.addEventListener("keydown", handleKeyDown, true);
	}
});

onDestroy(() => {
	if (typeof window !== "undefined") {
		window.removeEventListener("keydown", handleKeyDown, true);
	}
});
</script>

<div class="flex items-center gap-2">
	{#if isRecording}
		<div class="flex items-center gap-1.5 px-2 py-1 rounded border border-primary/50 bg-primary/10">
			<span class="relative flex h-2 w-2">
				<span
					class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"
				></span>
				<span class="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
			</span>
			<span class="text-xs text-muted-foreground">{m.settings_keybindings_press_keys()}</span>
		</div>
	{:else if newKey}
		<div class="flex items-center gap-2">
			<KbdGroup>
				{#each formatKeyStringToArray(newKey) as key (key)}
					<Kbd>{key}</Kbd>
				{/each}
			</KbdGroup>
			{#if error}
				<span class="text-xs text-destructive">{error}</span>
				<button
					type="button"
					onclick={() => {
						isRecording = true;
						newKey = null;
						error = null;
					}}
					class="text-xs text-muted-foreground hover:text-foreground underline"
				>
					{m.settings_keybindings_retry()}
				</button>
				<button
					type="button"
					onclick={handleCancel}
					class="text-xs text-muted-foreground hover:text-foreground underline"
				>
					{m.common_cancel()}
				</button>
			{/if}
		</div>
	{/if}
</div>
