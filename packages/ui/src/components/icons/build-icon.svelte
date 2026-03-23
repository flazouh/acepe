<script lang="ts">
	import { Screwdriver } from "phosphor-svelte";

	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
		style?: string;
	}

	let { size = "md", class: className, style }: Props = $props();

	const sizeClasses = {
		sm: "size-3",
		md: "size-3.5",
		lg: "size-4",
	};
</script>

<Screwdriver class="{sizeClasses[size]} text-success {className ?? ''}" {style} weight="fill" />
