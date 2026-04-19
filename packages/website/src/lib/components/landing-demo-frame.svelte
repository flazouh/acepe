<script lang="ts">
  import { Bug, HardDrives, SlidersHorizontal } from "phosphor-svelte";
  import type { Snippet } from "svelte";

  import { AppTopBar } from "@acepe/ui/app-layout";

interface Props {
	children?: Snippet;
	interactive?: boolean;
}

let { children, interactive = false }: Props = $props();
</script>

<div
	inert={!interactive}
	class="relative overflow-hidden rounded-lg border border-white/10 bg-background shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
>
	<div class="flex aspect-[16/10.5] flex-col pt-0.5 pb-0.5">
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
						<SlidersHorizontal class="size-4" weight="fill" />
					</button>
					<button
						class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
						title="Feedback"
						aria-label="Feedback"
						type="button"
					>
						<Bug class="size-4" weight="fill" style="color: #FF5D5A" />
					</button>
					<button
						class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
						title="Database Manager"
						aria-label="Database Manager"
						type="button"
					>
						<HardDrives class="size-4" weight="fill" />
					</button>
				{/snippet}
			</AppTopBar>
		</div>
		<div class="flex min-h-0 flex-1 overflow-hidden px-px">
			{@render children?.()}
		</div>
	</div>
</div>
