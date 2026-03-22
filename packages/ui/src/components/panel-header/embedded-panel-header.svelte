<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		children?: Snippet;
		onHeaderClick?: (() => void) | undefined;
		class?: string;
	}

	let { children, onHeaderClick, class: className = "" }: Props = $props();

	function handleClick(event: MouseEvent): void {
		if (!onHeaderClick) return;
		const target = event.target as HTMLElement;
		if (target.closest("button") || target.closest("[role='button']") || target.closest("[data-header-control]")) {
			return;
		}
		onHeaderClick();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!onHeaderClick) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		onHeaderClick();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="shrink-0 flex items-center h-7 border-b border-border/50 {onHeaderClick ? 'cursor-pointer' : ''} {className}"
	role={onHeaderClick ? "button" : undefined}
	tabindex={onHeaderClick ? 0 : undefined}
	onclick={handleClick}
	onkeydown={handleKeydown}
>
	{@render children?.()}
</div>
