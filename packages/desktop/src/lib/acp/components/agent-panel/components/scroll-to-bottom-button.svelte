<script lang="ts">
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import * as m from "$lib/paraglide/messages.js";

interface ScrollToBottomButtonProps {
	/**
	 * Whether the button should be visible.
	 * True when user is not at the bottom of the scroll area.
	 */
	visible: boolean;

	/**
	 * Callback triggered when the button is clicked.
	 */
	onClick: () => void;
}

let { visible, onClick }: ScrollToBottomButtonProps = $props();
</script>

{#if visible}
	<button
		class="h-8 w-8 flex items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-muted transition-colors"
		onclick={onClick}
		aria-label={m.agent_panel_scroll_bottom()}
	>
		<ArrowDown class="h-4 w-4" />
	</button>
{/if}
