<script lang="ts">
import { useSidebar } from "$lib/components/ui/sidebar/index.js";

const sidebar = useSidebar();

function handleSidebarClick(e: MouseEvent) {
	// Only expand if collapsed and click is not on an interactive element
	// Check both state and open to be sure
	const isCollapsed = !sidebar.open || sidebar.state === "collapsed";

	if (isCollapsed) {
		const target = e.target as HTMLElement;
		// Don't expand if clicking on buttons, links, or other interactive elements
		if (
			target.tagName === "BUTTON" ||
			target.tagName === "A" ||
			target.closest("button") ||
			target.closest("a") ||
			target.closest("[role='button']") ||
			target.closest("[data-sidebar='trigger']")
		) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		sidebar.setOpen(true);
	}
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="flex-1 flex flex-col"
	onclick={handleSidebarClick}
	role={sidebar.state === "collapsed" ? "button" : undefined}
	tabindex={sidebar.state === "collapsed" ? 0 : undefined}
	onkeydown={(e) => {
		if (sidebar.state === "collapsed" && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			sidebar.setOpen(true);
		}
	}}
>
	<slot />
</div>
