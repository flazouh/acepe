<script lang="ts">
	/**
	 * PlanSidebarLayout — Presentational plan panel.
	 * Shows plan title, markdown content, and an optional Build button in the header.
	 * No Tauri coupling, no store access — props in, callbacks out.
	 *
	 * Extension points via optional snippets:
	 * - headerActions: extra buttons in the header row (after title)
	 * - contentRenderer: replaces built-in MarkdownDisplay
	 * - afterContent: content after the markdown area (e.g., todos)
	 */
	import type { Snippet } from "svelte";

	import {
		CloseAction,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";
	import MarkdownDisplay from "../markdown/markdown-display.svelte";
	import PlanIcon from "../icons/plan-icon.svelte";

	interface Props {
		title: string;
		slug: string;
		content?: string;
		onClose?: () => void;
		/** Base path for file type SVG icons. Empty string falls back to colored dots. */
		iconBasePath?: string;
		class?: string;
		/** Extra buttons rendered in header row after the title. */
		headerActions?: Snippet;
		/** Replaces built-in MarkdownDisplay with a custom renderer. */
		contentRenderer?: Snippet;
		/** Content after the markdown area (e.g., todos section). */
		afterContent?: Snippet;
	}

	let {
		title,
		slug,
		content,
		onClose,
		iconBasePath = "",
		class: className,
		headerActions,
		contentRenderer,
		afterContent,
	}: Props = $props();
</script>

<div class="flex h-full flex-col overflow-hidden {className ?? ''}">
	<!-- Header -->
	<EmbeddedPanelHeader class="bg-muted/30">
		<HeaderTitleCell compactPadding>
			<PlanIcon size="sm" class="shrink-0 mr-1" />
			<span class="text-[11px] text-foreground select-none truncate leading-none">
				{title}
			</span>
		</HeaderTitleCell>

		<HeaderActionCell>
			{#if headerActions}
				{@render headerActions()}
			{/if}
		</HeaderActionCell>

		{#if onClose}
			<HeaderActionCell>
				<CloseAction onClose={onClose} />
			</HeaderActionCell>
		{/if}
	</EmbeddedPanelHeader>

	<!-- Content -->
	<div class="min-h-0 flex-1 {contentRenderer ? '' : 'overflow-y-auto px-4 py-3'}">
		{#if contentRenderer}
			{@render contentRenderer()}
		{:else if content}
			<MarkdownDisplay content={content} iconBasePath={iconBasePath} />
		{/if}
	</div>

	<!-- After content (e.g., todos) -->
	{#if afterContent}
		{@render afterContent()}
	{/if}
</div>
