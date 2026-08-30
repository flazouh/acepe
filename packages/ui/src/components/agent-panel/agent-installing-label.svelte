<script lang="ts">
	import { TextShimmer } from "../text-shimmer/index.js";

	// The one indeterminate install indicator. Both install surfaces -- the
	// agent picker row and the pre-composer install card -- show the same
	// thing, because the backend install call reports nothing between start
	// and finish. `data-install-state` is what a QA read asserts on: no
	// progressbar, no percentage, just this.
	interface Props {
		label?: string;
		class?: string;
	}

	let { label = "Installing…", class: className = "" }: Props = $props();
</script>

<span class={className} role="status" data-install-state="indeterminate">
	<TextShimmer>{label}</TextShimmer>
</span>
