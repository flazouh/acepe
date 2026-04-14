<script lang="ts">
	import { AppWindow, CaretRight } from "phosphor-svelte";

	import AgentToolCard from "./agent-tool-card.svelte";
	import ToolLabel from "./tool-label.svelte";
	import type { AgentToolStatus } from "./types.js";

	const SCRIPT_COLLAPSE_CHARACTER_LIMIT = 280;
	const SCRIPT_COLLAPSE_LINE_LIMIT = 6;
	const SCRIPT_PREVIEW_LINE_LIMIT = 3;

	interface Props {
		title: string;
		subtitle?: string | null;
		detailsText?: string | null;
		scriptText?: string | null;
		status?: AgentToolStatus;
		durationLabel?: string;
		detailsLabel?: string;
		scriptLabel?: string;
	}

	let {
		title,
		subtitle = null,
		detailsText = null,
		scriptText = null,
		status = "done",
		durationLabel,
		detailsLabel = "Result",
		scriptLabel = "Script",
	}: Props = $props();

	let isResultExpanded = $state(false);
	let isScriptExpanded = $state(false);

	function countLines(text: string): number {
		return text.split("\n").length;
	}

	function buildScriptPreview(text: string): string {
		const trimmed = text.trim();
		if (!trimmed) return "";
		const lines = trimmed.split("\n");
		const limitedLines = lines.slice(0, SCRIPT_PREVIEW_LINE_LIMIT);
		const preview = limitedLines.join("\n");
		if (lines.length > SCRIPT_PREVIEW_LINE_LIMIT || trimmed.length > preview.length) {
			return `${preview}\n...`;
		}
		return preview;
	}

	const hasDetails = $derived(Boolean(detailsText && detailsText.trim().length > 0));
	const normalizedScriptText = $derived(scriptText?.trim() ?? "");
	const hasScript = $derived(normalizedScriptText.length > 0);
	const isScriptCollapsible = $derived(
		hasScript &&
			(normalizedScriptText.length > SCRIPT_COLLAPSE_CHARACTER_LIMIT ||
				countLines(normalizedScriptText) > SCRIPT_COLLAPSE_LINE_LIMIT)
	);
	const scriptPreview = $derived(
		hasScript ? buildScriptPreview(normalizedScriptText) : null
	);
	const preview = $derived.by(() => {
		if (!detailsText) return null;
		const compact = detailsText.replace(/\s+/g, " ").trim();
		if (!compact) return null;
		return compact.length > 140 ? `${compact.slice(0, 140)}...` : compact;
	});
</script>

<AgentToolCard>
	<div
		class="flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-xs"
		class:border-b={hasDetails || hasScript}
		class:border-border={hasDetails || hasScript}
	>
		<AppWindow weight="duotone" size={14} class="shrink-0 text-muted-foreground/70" />
		<ToolLabel {status}>{title}</ToolLabel>

		{#if subtitle}
			<span class="min-w-0 truncate text-muted-foreground/70">{subtitle}</span>
		{/if}

		{#if preview}
			<span class="min-w-0 truncate text-muted-foreground/55">{preview}</span>
		{/if}

		{#if durationLabel}
			<span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
				{durationLabel}
			</span>
		{/if}
	</div>

	{#if hasScript}
		<div>
			{#if isScriptCollapsible}
				<button
					type="button"
					onclick={() => {
						isScriptExpanded = !isScriptExpanded;
					}}
					class="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/30 cursor-pointer"
					aria-label={isScriptExpanded ? "Collapse script" : "Expand script"}
				>
					<CaretRight
						size={10}
						weight="bold"
						class="shrink-0 transition-transform duration-150 {isScriptExpanded ? 'rotate-90' : ''}"
					/>
					<span class="shrink-0 font-medium">{scriptLabel}</span>
					{#if !isScriptExpanded && scriptPreview}
						<pre
							class="browser-script-preview min-w-0 truncate text-left text-muted-foreground/70"
							data-testid="browser-script-preview"
						>
{scriptPreview}</pre
						>
					{/if}
				</button>

				{#if isScriptExpanded}
					<div class="border-t border-border bg-muted/20 px-2.5 py-2">
						<pre
							class="browser-script-block text-foreground"
							data-testid="browser-script-content"
						>{normalizedScriptText}</pre>
					</div>
				{/if}
			{:else}
				<div class="border-t border-border bg-muted/20 px-2.5 py-2">
					<div class="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
						{scriptLabel}
					</div>
					<pre
						class="browser-script-block text-foreground"
						data-testid="browser-script-content"
					>{normalizedScriptText}</pre>
				</div>
			{/if}
		</div>
	{/if}

	{#if hasDetails && detailsText}
		<div>
			<button
				type="button"
				onclick={() => {
					isResultExpanded = !isResultExpanded;
				}}
				class="flex w-full items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/30 cursor-pointer"
				aria-label={isResultExpanded ? "Collapse result" : "Expand result"}
			>
				<CaretRight
					size={10}
					weight="bold"
					class="shrink-0 transition-transform duration-150 {isResultExpanded ? 'rotate-90' : ''}"
				/>
				<span class="shrink-0 font-medium">{detailsLabel}</span>
				{#if !isResultExpanded && preview}
					<span class="min-w-0 truncate text-left text-muted-foreground/70">{preview}</span>
				{/if}
			</button>

			{#if isResultExpanded}
				<div class="border-t border-border bg-muted/20 px-2.5 py-2">
					<pre class="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{detailsText}</pre>
				</div>
			{/if}
		</div>
	{/if}
</AgentToolCard>

<style>
	.browser-script-block,
	.browser-script-preview {
		margin: 0;
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
		font-size: 0.75rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: break-word;
	}

	.browser-script-preview {
		display: block;
	}
</style>
