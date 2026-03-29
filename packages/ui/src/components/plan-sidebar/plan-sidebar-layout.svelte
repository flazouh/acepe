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
	import BuildIcon from "../icons/build-icon.svelte";
	import LoadingIcon from "../icons/loading-icon.svelte";

	interface Props {
		title: string;
		slug: string;
		content?: string;
		isBuilding?: boolean;
		onBuild?: () => void;
		onClose?: () => void;
		buildLabel?: string;
		buildingLabel?: string;
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
		isBuilding = false,
		onBuild,
		onClose,
		buildLabel = "Build",
		buildingLabel = "Building…",
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
			<PlanIcon size="md" class="shrink-0 mr-1.5" />
			<span class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none">
				{title}
			</span>
		</HeaderTitleCell>

		<HeaderActionCell>
			{#if onBuild}
				<button
					type="button"
					class="inline-flex items-center gap-1 px-2 text-[10px] font-medium font-mono text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
					onclick={onBuild}
					disabled={isBuilding}
			>
				{#if isBuilding}
					<LoadingIcon class="size-3 shrink-0 animate-spin" />
					{buildingLabel}
				{:else}
					<BuildIcon size="sm" />
					{buildLabel}
				{/if}
			</button>
			{/if}
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
