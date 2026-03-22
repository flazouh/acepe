<script lang="ts">
	import { ArrowCounterClockwise } from "phosphor-svelte";

	interface Props {
		size?: "xs" | "sm" | "md" | "lg";
		class?: string;
	}

	let { size = "md", class: className }: Props = $props();

	const sizeClasses = {
		xs: "size-2.5",
		sm: "size-3",
		md: "size-3.5",
		lg: "size-4",
	};
</script>

<ArrowCounterClockwise class={sizeClasses[size]} {className} weight="bold" />
