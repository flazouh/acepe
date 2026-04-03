<script lang="ts">
import Logo from "$lib/components/logo.svelte";
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
				<Logo class="h-6 w-6" />
			</div>
		{:else}
			<div class="flex items-center gap-1">
				<Logo class="h-6 w-6" />
				<h1 class="font-sans text-lg font-semibold text-sidebar-foreground">Acepe</h1>
			</div>
		{/if}
		<SidebarTrigger class="group-data-[collapsible=icon]:hidden" />
	</div>
</SidebarHeader>
