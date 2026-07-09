<script lang="ts">
	import type { Snippet } from "svelte";
	import { RoundedIcon } from "../icons/index.js";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolStatus } from "./types.js";
	import { getThinkingPreferences } from "../../lib/thinking-preferences-context.js";
	import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip/index.js";
	import {
		getNextThinkingCollapsed,
		getThinkingCollapseLabel,
		getThinkingPreferenceState,
		hasThinkingContent,
	} from "./agent-tool-thinking-state.js";

	interface Props {
		/** Label to display (e.g. "Thinking", "Thinking for 3s", "Thought for 3s") */
		headerLabel?: string;
		/** Optional custom header content; overrides headerLabel when provided. */
		header?: Snippet;
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
		/** Whether thinking blocks are expanded by default (global preference) */
		defaultExpanded?: boolean;
		/** Callback to toggle the default expand preference */
		onToggleDefaultExpand?: () => void;
	}

	let {
		headerLabel = "Thought",
		header,
		showHeader = true,
		status = "done",
		collapsed = true,
		onCollapseChange,
		children,
		ariaExpandLabel = "Expand thinking",
		ariaCollapseLabel = "Collapse thinking",
		defaultExpanded,
		onToggleDefaultExpand,
	}: Props = $props();

	const thinkingPrefs = getThinkingPreferences();
	const preferenceState = $derived(
		getThinkingPreferenceState({
			defaultExpanded,
			onToggleDefaultExpand,
			contextDefaultExpanded: thinkingPrefs?.defaultExpanded,
			contextToggleDefaultExpand: thinkingPrefs?.onToggleDefaultExpand,
		})
	);
	const hasContent = $derived(hasThinkingContent(children !== undefined));
	const collapseLabel = $derived(
		getThinkingCollapseLabel({
			collapsed,
			ariaExpandLabel,
			ariaCollapseLabel,
		})
	);

	function toggleCollapsed(): void {
		const next = getNextThinkingCollapsed(collapsed);
		if (onCollapseChange) {
			onCollapseChange(next);
		}
	}
</script>

<div class="flex min-w-0 flex-1 flex-col text-sm">
	{#if showHeader}
		<div class="group/thinking-header flex min-w-0 flex-1 items-center gap-1">
			<!-- Label — click to toggle collapse -->
			<button
				type="button"
				class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 overflow-hidden border-0 bg-transparent p-0 text-left transition-colors hover:text-foreground"
				onclick={toggleCollapsed}
				aria-label={collapseLabel}
				aria-expanded={!collapsed}
			>
				<ToolLabel {status} size="sm">
					{#if header}
						{@render header()}
					{:else}
						{headerLabel}
					{/if}
				</ToolLabel>
			</button>

			<!-- Expand toggle — show on hover, left of chevron -->
			{#if preferenceState.onToggleDefaultExpand}
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props: triggerProps })}
							<button
								{...triggerProps}
								type="button"
								class="shrink-0 p-0.5 opacity-0 group-hover/thinking-header:opacity-100 transition-opacity hover:text-foreground {preferenceState.defaultExpandClass}"
								onclick={(e) => { e.stopPropagation(); preferenceState.onToggleDefaultExpand?.(); }}
								aria-label={preferenceState.defaultExpandLabel}
							>
								<RoundedIcon name="brain" class="size-[11px]" data-testid="thinking-default-expand-brain-icon" />
							</button>
						{/snippet}
					</TooltipTrigger>
					<TooltipContent>
						{preferenceState.defaultExpandLabel}
					</TooltipContent>
				</Tooltip>
			{/if}

			<!-- Caret — click to toggle collapse -->
			{#if hasContent}
				<button
					type="button"
					class="shrink-0 cursor-pointer border-0 bg-transparent p-0.5"
					onclick={toggleCollapsed}
					tabindex="-1"
					aria-hidden="true"
				>
					<CaretRight size={12} weight="regular" class="size-3 shrink-0 text-muted-foreground transition-transform duration-150 {collapsed ? '' : 'rotate-90'}"
					/>
				</button>
			{/if}
		</div>
	{/if}

	{#if !collapsed && children}
		<div class="mt-1.5 flex min-w-0 items-stretch gap-2 text-xs leading-normal">
			<div
				data-testid="thinking-block-line"
				class="w-px shrink-0 self-stretch rounded-full bg-border/70"
				aria-hidden="true"
			></div>
			<div data-testid="thinking-block-content" class="min-w-0 flex-1 text-xs leading-normal">
				{@render children()}
			</div>
		</div>
	{/if}
</div>
