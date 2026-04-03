<script lang="ts">
import logo from "../../../../../assets/logo.svg?url";
import { cn } from "$lib/utils.js";

let { class: className = "" }: { class?: string } = $props();
</script>

<img
	src={logo}
	alt=""
	aria-hidden="true"
	class={cn("h-6 w-6 shrink-0 object-contain", className)}
/>
