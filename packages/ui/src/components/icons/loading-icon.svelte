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

<span {role} aria-label={ariaLabel} {style}>
	<svg
		aria-hidden="true"
		width="16px"
		height="16px"
		fill="none"
		viewBox="0 0 16 16"
		class={cn("size-4 shrink-0 animate-spin", className)}
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			fill="none"
			stroke="#bf8700"
			stroke-width="2"
			d="M3.05 3.05a7 7 0 1 1 9.9 9.9 7 7 0 0 1-9.9-9.9Z"
			opacity=".5"
		></path>
		<path
			fill="#bf8700"
			fill-rule="evenodd"
			d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
			clip-rule="evenodd"
		></path>
		<path fill="#bf8700" d="M14 8a6 6 0 0 0-6-6V0a8 8 0 0 1 8 8h-2Z"></path>
	</svg>
</span>
