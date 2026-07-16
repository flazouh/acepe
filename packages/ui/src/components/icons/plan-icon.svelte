<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";

	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
		style?: string;
		"data-testid"?: string;
	}

	let { size = "md", class: className, style, "data-testid": dataTestid }: Props = $props();

	const sizeClasses = {
		sm: "size-3",
		md: "size-3.5",
		lg: "size-4",
	};
</script>

<span
	class="plan-icon-root inline-flex shrink-0 items-center justify-center {sizeClasses[size]} {className ? className : ''}"
	style={style}
	data-testid={dataTestid}
>
	<HugeiconsIcon name="plan" class="block size-full max-h-full max-w-full text-current" />
</span>

<style>
	.plan-icon-root {
		color: var(--plan-icon, var(--token-plan-icon-light, #ff8d20));
	}

	.plan-icon-root.text-current {
		color: currentColor;
	}
</style>
