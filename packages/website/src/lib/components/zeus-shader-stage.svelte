<script lang="ts">
import { BrandGradientBackground } from "@acepe/ui";

interface Props {
	class?: string;
	heightClass?: string;
}

let { class: className = "", heightClass = "h-full" }: Props = $props();
</script>

<div
	class="pointer-events-none absolute inset-x-0 top-0 overflow-hidden {heightClass} {className}"
	data-slot="iris-gradient-zeus-stage"
	aria-hidden="true"
>
	<BrandGradientBackground />
	<div class="absolute inset-0 vignette"></div>
	<div class="absolute inset-x-0 top-0 h-32 top-fade"></div>
	<div class="absolute inset-x-0 bottom-0 h-56 bottom-fade"></div>
</div>

<style>
	.vignette {
		background: radial-gradient(130% 90% at 50% 50%, transparent 0%, transparent 65%, color-mix(in srgb, var(--background) 30%, transparent) 85%, color-mix(in srgb, var(--background) 75%, transparent) 100%);
	}

	.top-fade {
		background: linear-gradient(to bottom, color-mix(in srgb, var(--background) 42%, transparent) 0%, transparent 100%);
	}

	.bottom-fade {
		background: linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--background) 35%, transparent) 50%, color-mix(in srgb, var(--background) 85%, transparent) 82%, var(--background) 100%);
	}
</style>
