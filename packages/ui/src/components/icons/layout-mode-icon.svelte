<script lang="ts">
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
</script>

<span
	class="inline-flex shrink-0 {className}"
	style:color={color}
	data-testid={dataTestid}
	aria-hidden="true"
>
	{#if mode === "grid"}
		<span class="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
			<span class="rounded-[1px] bg-current"></span>
			<span class="rounded-[1px] bg-current"></span>
			<span class="rounded-[1px] bg-current"></span>
			<span class="rounded-[1px] bg-current"></span>
		</span>
	{:else if mode === "single"}
		<span class="h-full w-full rounded-[2px] bg-current"></span>
	{:else if mode === "kanban"}
		<span class="flex h-full w-full items-stretch gap-0.5">
			<span class="flex w-[3px] flex-col gap-px">
				<span class="h-[5px] rounded-[1px] bg-current"></span>
				<span class="h-[3px] rounded-[1px] bg-current opacity-60"></span>
			</span>
			<span class="flex w-[3px] flex-col gap-px">
				<span class="h-[3px] rounded-[1px] bg-current opacity-75"></span>
				<span class="h-[5px] rounded-[1px] bg-current opacity-75"></span>
			</span>
			<span class="flex w-[3px] flex-col gap-px">
				<span class="h-[4px] rounded-[1px] bg-current opacity-55"></span>
				<span class="h-[3px] rounded-[1px] bg-current opacity-55"></span>
			</span>
		</span>
	{:else}
		<span class="flex h-full w-full items-stretch gap-px">
			<span class="w-[3px] rounded-[1px] bg-current"></span>
			<span class="w-[3px] rounded-[1px] bg-current opacity-75"></span>
			<span class="w-[3px] rounded-[1px] bg-current opacity-55"></span>
		</span>
	{/if}
</span>
