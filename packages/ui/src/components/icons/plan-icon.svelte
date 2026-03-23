<script lang="ts">
	import { PencilRuler } from "phosphor-svelte";
	import { Colors } from "../../lib/colors.js";

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

<PencilRuler class="{sizeClasses[size]} {className ?? ''}" style="color: {Colors.orange}; {style ?? ''}" weight="fill" />
