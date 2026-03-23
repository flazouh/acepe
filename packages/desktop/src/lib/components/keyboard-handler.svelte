<script lang="ts">
import { onDestroy, onMount } from "svelte";

interface KeyboardHandlerProps {
	onModePickerToggle?: () => void;
	onModelPickerToggle?: () => void;
}

let { onModePickerToggle, onModelPickerToggle }: KeyboardHandlerProps = $props();

function handleKeyDown(event: KeyboardEvent) {
	// Cmd+K for mode picker
	if ((event.metaKey || event.ctrlKey) && event.key === "k") {
		event.preventDefault();
		onModePickerToggle?.();
		return;
	}

	// Cmd+M for model picker
	if ((event.metaKey || event.ctrlKey) && event.key === "m") {
		event.preventDefault();
		onModelPickerToggle?.();
		return;
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeyDown);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeyDown);
});
</script>
