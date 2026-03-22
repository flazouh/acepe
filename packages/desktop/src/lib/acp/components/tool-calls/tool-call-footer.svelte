<script lang="ts">
import * as m from "$lib/paraglide/messages.js";

import AnimatedChevron from "../animated-chevron.svelte";

interface ToolCallFooterProps {
	/**
	 * Whether the content is collapsed to a few lines view.
	 */
	isContentCollapsed: boolean;

	/**
	 * Callback to toggle content collapse state.
	 */
	onToggleCollapse: () => void;

	/**
	 * Optional aria-label for the button. If not provided, a default will be used.
	 */
	ariaLabel?: string;
}

let { isContentCollapsed, onToggleCollapse, ariaLabel }: ToolCallFooterProps = $props();

const defaultAriaLabel = $derived(
	isContentCollapsed ? m.tool_call_expand_content() : m.tool_call_collapse_content()
);
</script>

<!-- Footer with expand/collapse chevron -->
<button
	type="button"
	onclick={(e) => {
		e.stopPropagation();
		onToggleCollapse();
	}}
	class="flex items-center justify-center w-full py-1 border-t border-border hover:bg-muted transition-colors cursor-pointer"
	aria-label={ariaLabel ?? defaultAriaLabel}
>
	<AnimatedChevron isOpen={!isContentCollapsed} class="h-3 w-3 text-muted-foreground" />
</button>
