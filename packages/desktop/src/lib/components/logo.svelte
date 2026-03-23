<script lang="ts">
import { cn } from "$lib/utils.js";

let { class: className, ...restProps } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="32"
	height="32"
	viewBox="0 0 32 32"
	fill="none"
	class={cn("h-6 w-6 flex-shrink-0", className)}
	{...restProps}
>
	<!-- Acepe Logo - L4-V2: Orange gradient, light to dark -->
	<rect x="5" y="5" width="6" height="22" rx="2" fill="#F77E2C" fill-opacity="0.3" />
	<rect x="13" y="5" width="6" height="22" rx="2" fill="#F77E2C" fill-opacity="0.6" />
	<rect x="21" y="5" width="6" height="22" rx="2" fill="#F77E2C" />
</svg>
