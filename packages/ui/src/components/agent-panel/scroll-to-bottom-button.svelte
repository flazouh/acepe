<script lang="ts">
	import { LuArrowDown as ArrowDown } from "../icons/index.js";

	interface Props {
		visible: boolean;
		ariaLabel: string;
		onClick: () => void;
	}

	let { visible, ariaLabel, onClick }: Props = $props();
</script>

{#if visible}
	<button
		class="h-8 w-8 flex items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-muted transition-colors"
		onclick={onClick}
		aria-label={ariaLabel}
	>
		<ArrowDown class="h-4 w-4" />
	</button>
{/if}
