<script lang="ts">
import { onMount, tick } from "svelte";
import { TIMING } from "$lib/acp/constants/timing.js";
import { useSidebar } from "$lib/components/ui/sidebar/index.js";

const sidebar = useSidebar();

onMount(async () => {
	await tick();
	// Wait a bit more for the sidebar to be fully rendered
	setTimeout(() => {
		const sidebarElement = document.querySelector('[data-sidebar="sidebar"]');
		if (!sidebarElement) return;

		function handleClick(e: Event) {
			// Check if sidebar is collapsed
			const isCollapsed = !sidebar.open || sidebar.state === "collapsed";

			if (isCollapsed) {
				const mouseEvent = e as MouseEvent;
				const target = mouseEvent.target as HTMLElement;
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
				mouseEvent.preventDefault();
				mouseEvent.stopPropagation();
				sidebar.setOpen(true);
			}
		}

		sidebarElement.addEventListener("click", handleClick, true);

		return () => {
			sidebarElement.removeEventListener("click", handleClick, true);
		};
	}, TIMING.DEBOUNCE_MS);
});
</script>
