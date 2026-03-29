<script lang="ts">
	import { cn } from "../../lib/utils";

	interface Props {
		class?: string;
		role?: string;
		"aria-label"?: string;
		style?: string;
	}

	let { class: className = "", role, "aria-label": ariaLabel, style = "" }: Props = $props();
</script>

<span {role} aria-label={ariaLabel}>
	<svg
		aria-hidden="true"
		fill="none"
		viewBox="0 0 16 16"
		class={cn("shrink-0 animate-spin", className)}
		{style}
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			fill="none"
			stroke="#bf8700"
			stroke-width="2"
			d="M3.05 3.05a7 7 0 1 1 9.9 9.9 7 7 0 0 1-9.9-9.9Z"
			opacity=".5"
		></path>
		<path fill="#bf8700" d="M14 8a6 6 0 0 0-6-6V0a8 8 0 0 1 8 8h-2Z"></path>
	</svg>
</span>
