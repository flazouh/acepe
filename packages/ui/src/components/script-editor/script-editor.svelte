<script lang="ts">
	import { cn } from "../../lib/utils.js";

	interface Props {
		value: string;
		onChange?: (value: string) => void;
		onBlur?: (value: string) => void;
		onFocus?: () => void;
		/** Returns inner highlighted HTML (no wrapping <pre><code>) or null when not ready. */
		highlight?: (code: string) => string | null;
		placeholder?: string;
		/** Minimum number of visible rows (gutter padding). */
		minLines?: number;
		/** Maximum number of visible rows before scroll. */
		maxLines?: number;
		disabled?: boolean;
		readonly?: boolean;
		ariaLabel?: string;
		class?: string;
		id?: string;
	}

	let {
		value = $bindable(""),
		onChange,
		onBlur,
		onFocus,
		highlight,
		placeholder = "",
		minLines = 3,
		maxLines,
		disabled = false,
		readonly = false,
		ariaLabel,
		class: className = "",
		id,
	}: Props = $props();

	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let preEl = $state<HTMLPreElement | null>(null);
	let gutterEl = $state<HTMLDivElement | null>(null);

	const lines = $derived.by(() => {
		const arr = value.length === 0 ? [""] : value.split("\n");
		while (arr.length < minLines) arr.push("");
		return arr;
	});

	const lineCount = $derived(lines.length);

	const highlightedHtml = $derived.by(() => {
		if (!highlight) return null;
		const source = value.length === 0 ? " " : value;
		return highlight(source);
	});

	function handleInput(event: Event) {
		const target = event.currentTarget as HTMLTextAreaElement;
		value = target.value;
		onChange?.(target.value);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Tab") {
			event.preventDefault();
			const target = event.currentTarget as HTMLTextAreaElement;
			const start = target.selectionStart;
			const end = target.selectionEnd;
			const next = value.slice(0, start) + "  " + value.slice(end);
			value = next;
			onChange?.(next);
			requestAnimationFrame(() => {
				target.selectionStart = target.selectionEnd = start + 2;
			});
		}
	}

	function syncScroll() {
		if (!textareaEl) return;
		if (preEl) {
			preEl.scrollTop = textareaEl.scrollTop;
			preEl.scrollLeft = textareaEl.scrollLeft;
		}
		if (gutterEl) {
			gutterEl.scrollTop = textareaEl.scrollTop;
		}
	}

	const maxHeightStyle = $derived(
		maxLines !== undefined ? `max-height: calc(${maxLines} * 1.5em + 16px);` : ""
	);
</script>

<div
	class={cn(
		"script-editor flex min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/20 font-mono text-[12px] leading-[1.5] shadow-sm focus-within:border-ring/60 focus-within:ring-1 focus-within:ring-ring/20",
		disabled && "opacity-60 pointer-events-none",
		className
	)}
>
	<div
		bind:this={gutterEl}
		class="script-editor-gutter shrink-0 select-none overflow-hidden border-r border-border/40 bg-muted/30 px-2 py-2 text-right text-muted-foreground/50 tabular-nums"
		aria-hidden="true"
	>
		{#each lines as _line, i (i)}
			<div class="script-editor-line-number">{i + 1}</div>
		{/each}
	</div>
	<div class="relative min-w-0 flex-1" style={maxHeightStyle}>
		<pre
			bind:this={preEl}
			class="script-editor-pre pointer-events-none m-0 overflow-auto whitespace-pre-wrap break-words px-3 py-2"
			aria-hidden="true"
		>{#if highlightedHtml}{@html highlightedHtml}{:else}<code class="text-foreground">{value || " "}</code>{/if}</pre>
		<textarea
			{id}
			bind:this={textareaEl}
			class="script-editor-textarea absolute inset-0 m-0 h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/40 placeholder:italic"
			spellcheck="false"
			autocorrect="off"
			autocapitalize="off"
			autocomplete="off"
			{placeholder}
			disabled={disabled}
			readonly={readonly}
			rows={Math.max(minLines, lineCount)}
			aria-label={ariaLabel}
			{value}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onscroll={syncScroll}
			onblur={() => onBlur?.(value)}
			onfocus={() => onFocus?.()}
		></textarea>
	</div>
</div>

<style>
	.script-editor-gutter {
		font-size: inherit;
		line-height: inherit;
	}

	.script-editor-line-number {
		min-width: 1.5em;
	}

	.script-editor-pre {
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
		height: 100%;
	}

	.script-editor-pre :global(.shiki),
	.script-editor-pre :global(code) {
		background: transparent !important;
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
	}

	/* Shiki dual-theme: tokens carry --shiki-light / --shiki-dark as inline vars. */
	.script-editor-pre :global(span) {
		color: var(--shiki-light);
	}

	:global(.dark) .script-editor-pre :global(span) {
		color: var(--shiki-dark);
	}

	.script-editor-pre :global(.line) {
		display: block;
		min-height: 1.5em;
	}

	/* Textarea text is fully transparent; caret/selection remain visible. */
	.script-editor-textarea {
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
		tab-size: 2;
	}
</style>
