<script lang="ts">
	import { PencilRuler } from "phosphor-svelte";

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

<span
	class="plan-icon-root inline-flex shrink-0 items-center justify-center {sizeClasses[size]} {className ? className : ''}"
	style={style}
>
	<PencilRuler class="block size-full max-h-full max-w-full" weight="fill" />
</span>

<style>
	.plan-icon-root {
		color: var(--plan-icon, var(--token-plan-icon-light, #ff8d20));
	}

	.plan-icon-root.text-current {
		color: currentColor;
	}
</style>
