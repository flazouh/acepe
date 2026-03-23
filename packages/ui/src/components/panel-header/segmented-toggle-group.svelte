<script lang="ts">
	import type { Snippet } from "svelte";

	interface SegmentedToggleItem {
		readonly id: string;
		readonly label: string;
		readonly disabled?: boolean;
	}

	interface Props {
		items: readonly SegmentedToggleItem[];
		value: string;
		onChange: (id: string) => void;
		class?: string;
		itemClass?: string;
		itemContent?: Snippet<[SegmentedToggleItem]>;
	}

	let {
		items,
		value,
		onChange,
		class: className = "",
		itemClass = "",
		itemContent,
	}: Props = $props();
</script>

<div class="h-6 flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5 {className}">
	{#each items as item (item.id)}
		<button
			type="button"
			disabled={item.disabled}
			onclick={() => onChange(item.id)}
			class="h-5 inline-flex items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none {value ===
			item.id
				? 'bg-background text-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground hover:bg-accent/40'} {itemClass}"
			data-header-control
		>
			{#if itemContent}
				{@render itemContent(item)}
			{:else}
				<span>{item.label}</span>
			{/if}
		</button>
	{/each}
</div>
