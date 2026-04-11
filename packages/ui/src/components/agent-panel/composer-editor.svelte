<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		editorRef?: HTMLDivElement | null;
		placeholder?: string;
		isEmpty?: boolean;
		minHeight?: string;
		maxHeight?: string;
		onbeforeinput?: (event: InputEvent) => void;
		oninput?: () => void;
		onkeydown?: (event: KeyboardEvent) => void;
		onkeyup?: (event: KeyboardEvent) => void;
		onfocus?: (event: FocusEvent) => void;
		onblur?: (event: FocusEvent) => void;
		onclick?: (event: MouseEvent) => void;
		onmouseover?: (event: MouseEvent) => void;
		onmouseout?: (event: MouseEvent) => void;
		onpaste?: (event: ClipboardEvent) => void;
		oncut?: (event: ClipboardEvent) => void;
		overlay?: Snippet;
		trailing?: Snippet;
	}

	let {
		editorRef = $bindable(null),
		placeholder = "Type a message...",
		isEmpty = true,
		minHeight = "72px",
		maxHeight = "400px",
		onbeforeinput,
		oninput,
		onkeydown,
		onkeyup,
		onfocus,
		onblur,
		onclick,
		onmouseover,
		onmouseout,
		onpaste,
		oncut,
		overlay,
		trailing,
	}: Props = $props();
</script>

<div class="relative min-w-0">
	{#if trailing}
		<div class="absolute top-0 right-0 flex items-center gap-2 z-10">
			{@render trailing()}
		</div>
	{/if}
	<div class="relative flex-1 min-w-0 {trailing ? 'pr-12' : ''}">
		<!-- svelte-ignore a11y_mouse_events_have_key_events -->
		<div
			bind:this={editorRef}
			role="textbox"
			aria-multiline="true"
			aria-label={placeholder}
			tabindex="0"
			contenteditable="true"
			autocapitalize="off"
			spellcheck={false}
			class="overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground outline-none"
			style="min-height: {minHeight}; max-height: {maxHeight};"
			{onbeforeinput}
			{oninput}
			{onkeydown}
			{onkeyup}
			{onfocus}
			{onblur}
			{onclick}
			{onmouseover}
			{onmouseout}
			{onpaste}
			{oncut}
		></div>
		{#if overlay}
			{@render overlay()}
		{/if}
		{#if isEmpty}
			<div
				class="pointer-events-none absolute left-0 top-0 text-sm leading-relaxed text-muted-foreground select-none"
			>
				{placeholder}
			</div>
		{/if}
	</div>
</div>
