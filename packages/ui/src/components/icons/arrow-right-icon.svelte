<script lang="ts">
	import { IconArrowRight } from "@tabler/icons-svelte";

	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
	}

	let { size = "md", class: className }: Props = $props();

	const sizeMap = {
		sm: 12,
		md: 14,
		lg: 18,
	};
</script>

<IconArrowRight size={sizeMap[size]} {className} />
