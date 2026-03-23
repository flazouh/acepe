<script lang="ts">
import * as m from "$lib/paraglide/messages.js";

import AnimatedChevron from "../../../animated-chevron.svelte";

interface ExecuteToolFooterProps {
	/**
	 * Whether the content is collapsed to a few lines view.
	 */
	isContentCollapsed: boolean;

	/**
	 * Callback to toggle content collapse state.
	 */
	onToggleCollapse: () => void;
}

let { isContentCollapsed, onToggleCollapse }: ExecuteToolFooterProps = $props();
</script>

<!-- Footer with expand/collapse chevron -->
<button
	type="button"
	onclick={(e) => {
		e.stopPropagation();
		onToggleCollapse();
	}}
	class="flex items-center justify-center w-full py-1 border-t border-border hover:bg-muted transition-colors cursor-pointer"
	aria-label={isContentCollapsed ? m.tool_call_expand_content() : m.tool_call_collapse_content()}
>
	<AnimatedChevron isOpen={!isContentCollapsed} class="h-3 w-3 text-muted-foreground" />
</button>
