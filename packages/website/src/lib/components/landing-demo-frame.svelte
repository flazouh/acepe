<script lang="ts">
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
	<div class="flex aspect-[16/10] flex-col pt-0.5 pb-0.5">
		<div class="shrink-0">
			<AppTopBar
				showTrafficLights={true}
				showSidebarToggle={false}
				showAddProject={false}
				showSettings={false}
				showAvatar={false}
				showRightSectionLeadingBorder={false}
				showSearch={false}
			/>
		</div>
		<div class="flex min-h-0 flex-1 overflow-hidden px-px">
			{@render children?.()}
		</div>
	</div>
</div>
