<script lang="ts">
import { SidebarHeader, SidebarTrigger, useSidebar } from "$lib/components/ui/sidebar/index.js";

const sidebar = useSidebar();

function handleExpand(e: MouseEvent) {
	if (sidebar.state === "collapsed") {
		e.preventDefault();
		e.stopPropagation();
		sidebar.setOpen(true);
	}
}
</script>

<SidebarHeader>
	<div class="flex items-center justify-between gap-3">
		{#if sidebar.state === "collapsed"}
			<div
				class="flex items-center justify-center cursor-pointer rounded-md p-1.5 transition-all hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
				onclick={handleExpand}
				role="button"
				tabindex="0"
				onkeydown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						sidebar.setOpen(true);
					}
				}}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="32"
					height="32"
					viewBox="0 0 32 32"
					fill="none"
					class="h-6 w-6 flex-shrink-0"
				>
					<!-- Acepe Logo - L4-V2: Orange gradient, light to dark -->
					<rect x="5" y="5" width="6" height="22" rx="2" fill="#F77E2C" fill-opacity="0.3" />
					<rect x="13" y="5" width="6" height="22" rx="2" fill="#F77E2C" fill-opacity="0.6" />
					<rect x="21" y="5" width="6" height="22" rx="2" fill="#F77E2C" />
				</svg>
			</div>
		{:else}
			<div class="flex items-center gap-1">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="32"
					height="32"
					viewBox="0 0 32 32"
					fill="none"
					class="h-6 w-6 flex-shrink-0"
				>
					<!-- Acepe Logo - L4-V2: Orange gradient, light to dark -->
					<rect x="5" y="5" width="6" height="22" rx="2" fill="#F77E2C" fill-opacity="0.3" />
					<rect x="13" y="5" width="6" height="22" rx="2" fill="#F77E2C" fill-opacity="0.6" />
					<rect x="21" y="5" width="6" height="22" rx="2" fill="#F77E2C" />
				</svg>
				<h1 class="font-sans text-lg font-semibold text-sidebar-foreground">Acepe</h1>
			</div>
		{/if}
		<SidebarTrigger class="group-data-[collapsible=icon]:hidden" />
	</div>
</SidebarHeader>
