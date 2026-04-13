<script lang="ts">
import * as m from "$lib/messages.js";
import { TextShimmer } from "@acepe/ui";

let { class: className = "text-base text-foreground" }: { class?: string } = $props();
</script>

<TextShimmer class={`font-sans font-semibold tracking-[0.02em] ${className}`.trim()}>
	{m.app_name()}
</TextShimmer>
