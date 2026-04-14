<script lang="ts">
	import type { Snippet } from "svelte";
	import { CaretRight } from "phosphor-svelte";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		/** Label to display (e.g. "Thinking", "Thinking for 3s", "Thought for 3s") */
		headerLabel?: string;
		/** When false, header row is hidden (e.g. while streaming). Default true. */
		showHeader?: boolean;
		/** Tool status for shimmer animation */
		status?: AgentToolStatus;
		/** Whether the thinking content is collapsed */
		collapsed?: boolean;
		/** Callback when collapse state changes */
		onCollapseChange?: (collapsed: boolean) => void;
		/** Thinking content rendered when expanded */
		children?: Snippet;
		/** Aria label when collapsed */
		ariaExpandLabel?: string;
		/** Aria label when expanded */
		ariaCollapseLabel?: string;
	}

	let {
		headerLabel = "Thought",
		showHeader = true,
		status = "done",
		collapsed = true,
		onCollapseChange,
		children,
		ariaExpandLabel = "Expand thinking",
		ariaCollapseLabel = "Collapse thinking",
	}: Props = $props();

	const hasContent = $derived(children !== undefined);

	function toggleCollapsed(): void {
		const next = !collapsed;
		if (onCollapseChange) {
			onCollapseChange(next);
		}
	}
</script>

<div class="flex min-w-0 flex-1 flex-col">
	{#if showHeader}
		<button
			type="button"
			class="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left transition-colors hover:text-foreground"
			onclick={toggleCollapsed}
			aria-label={collapsed ? ariaExpandLabel : ariaCollapseLabel}
			aria-expanded={!collapsed}
		>
			<div class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
				<ToolLabel {status}>{headerLabel}</ToolLabel>
			</div>
			{#if hasContent}
				<CaretRight
					size={10}
					weight="bold"
					class="shrink-0 text-muted-foreground transition-transform duration-150 {collapsed ? '' : 'rotate-90'}"
				/>
			{/if}
		</button>
	{/if}

	{#if !collapsed && children}
		<div class="mt-2">
			{@render children()}
		</div>
	{/if}
</div>
