<script lang="ts">
import { RoundedIcon, StorageIcon } from "@acepe/ui";
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
						<button
							class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							title="Layout"
							aria-label="Layout Settings"
							type="button"
						>
							<RoundedIcon name="sliders" class="size-4" />
						</button>
						<button
							class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							title="Feedback"
							aria-label="Feedback"
							type="button"
						>
							<RoundedIcon name="bug" class="size-4" style="color: #FF5D5A" />
						</button>
						<button
							class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							title="Database Manager"
							aria-label="Database Manager"
							type="button"
						>
							<StorageIcon class="size-4" />
						</button>
					{/snippet}
				</AppTopBar>
			</div>
			<div class="flex min-h-0 flex-1 overflow-hidden">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
