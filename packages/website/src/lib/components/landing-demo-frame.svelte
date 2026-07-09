<script lang="ts">
import { Button, RoundedIcon, StorageIcon } from "@acepe/ui";
import type { Snippet } from "svelte";

import { AppTopBar } from "@acepe/ui/app-layout";

interface Props {
	children?: Snippet;
	interactive?: boolean;
	bare?: boolean;
}

let { children, interactive = false, bare = false }: Props = $props();
</script>

{#if bare}
	<div inert={!interactive} class="relative flex h-full w-full overflow-hidden rounded-lg border border-border/50 bg-background shadow-2xl">
		<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
			{@render children?.()}
		</div>
	</div>
{:else}
	<div
		inert={!interactive}
		class="relative overflow-hidden rounded-lg border border-white/10 bg-background shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
	>
		<div class="flex aspect-[16/10.5] flex-col pt-0.5 pb-0.5 overflow-hidden">
			<div class="shrink-0">
				<AppTopBar
					showTrafficLights={true}
					showSidebarToggle={true}
					showAddProject={true}
					showSettings={true}
					showAvatar={false}
					showRightSectionLeadingBorder={false}
					showSearch={false}
				>
					{#snippet extraRightActions()}
						<Button variant="ghost" size="icon" title="Layout" aria-label="Layout Settings">
							{#snippet children()}
								<RoundedIcon name="sliders" />
							{/snippet}
						</Button>
						<Button variant="ghost" size="icon" title="Feedback" aria-label="Feedback">
							{#snippet children()}
								<RoundedIcon name="bug" style="color: #FF5D5A" />
							{/snippet}
						</Button>
						<Button variant="ghost" size="icon" title="Database Manager" aria-label="Database Manager">
							{#snippet children()}
								<StorageIcon />
							{/snippet}
						</Button>
					{/snippet}
				</AppTopBar>
			</div>
			<div class="flex min-h-0 flex-1 overflow-hidden">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
