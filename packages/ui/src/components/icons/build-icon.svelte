<script lang="ts">
	import HugeiconsIcon from "./hugeicons-icon.svelte";
	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
		style?: string;
		"data-testid"?: string;
	}

	let { size = "md", class: className, style, "data-testid": testId }: Props = $props();

	const sizeClasses = {
		sm: "size-3",
		md: "size-3.5",
		lg: "size-4",
	};
</script>

<span
	class="build-icon-root inline-flex shrink-0 items-center justify-center {sizeClasses[size]} {className ? className : ''}"
	style={style}
	data-testid={testId}
	aria-hidden="true"
>
	<HugeiconsIcon name="code" class="size-full" />
</span>

<style>
	.build-icon-root {
		color: var(--build-icon, var(--color-success, var(--success)));
	}

	/* Mode bar and similar: parent sets color; keep inheriting that path. */
	.build-icon-root.text-current {
		color: currentColor;
	}

</style>
