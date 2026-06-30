<script lang="ts">
import type { ComponentProps } from "svelte";
import { RoundedIcon } from "@acepe/ui";
import { Button } from "$lib/components/ui/button/index.js";

import { useSidebar } from "./context.svelte.js";

let {
	ref = $bindable(null),
	class: className,
	onclick,
	...restProps
}: ComponentProps<typeof Button> & {
	onclick?: (e: MouseEvent) => void;
} = $props();

const sidebar = useSidebar();
</script>

<Button
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-chrome"
	class={className}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<RoundedIcon name="sidebar" class="size-4" />
	<span class="sr-only">Toggle Sidebar</span>
</Button>
