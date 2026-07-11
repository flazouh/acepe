<script lang="ts">
	import RoundedIcon from "./rounded-icon.svelte";
	type LayoutModeIconMode = "columns" | "grid" | "kanban" | "single";

	interface Props {
		mode: LayoutModeIconMode;
		color?: string;
		class?: string;
		"data-testid"?: string;
	}

	let {
		mode,
		color = "currentColor",
		class: className = "size-3",
		"data-testid": dataTestid,
	}: Props = $props();

	const iconName = $derived(
		mode === "grid" ? "apps" : mode === "single" ? "app-window" : mode === "kanban" ? "tasks" : "dock",
	);
</script>

<span
	class="inline-flex shrink-0 {className}"
	style:color={color}
	data-testid={dataTestid}
	aria-hidden="true"
>
	<RoundedIcon name={iconName} class="size-full" />
</span>
