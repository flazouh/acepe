<script lang="ts">
import { BRAND_GRADIENT_IRIS_STYLE } from "../../lib/brand-gradient.js";
import { cn } from "../../lib/utils.js";

interface Props {
	class?: string;
}

let { class: className }: Props = $props();
</script>

<div
	aria-hidden="true"
	class={cn("absolute inset-0", className)}
	data-slot="brand-gradient-background"
	style={BRAND_GRADIENT_IRIS_STYLE}
></div>
