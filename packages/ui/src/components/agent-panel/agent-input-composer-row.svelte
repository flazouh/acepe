<!--
  AgentInputComposerRow - Single-row composer shell: leading controls, editor, trailing controls.
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { IconArrowUp } from "@tabler/icons-svelte";
	import { Stop } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import type { AgentInputSubmitIntent } from "./agent-input-editor.svelte";

	interface Props {
		editorRef?: HTMLDivElement | null;
		placeholder?: string;
		isEmpty?: boolean;
		ariaLabel?: string;
		submitIntent?: AgentInputSubmitIntent;
		submitDisabled?: boolean;
		submitAriaLabel?: string;
		onSubmit?: () => void;
		onbeforeinput?: (event: InputEvent) => void;
		oninput?: (event: Event) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		onkeyup?: (event: KeyboardEvent) => void;
		onfocus?: (event: FocusEvent) => void;
		onblur?: (event: FocusEvent) => void;
		onclick?: (event: MouseEvent) => void;
		onmouseover?: (event: MouseEvent) => void;
		onmouseout?: (event: MouseEvent) => void;
		onpaste?: (event: ClipboardEvent) => void;
		oncut?: (event: ClipboardEvent) => void;
		leading?: Snippet;
		trailing?: Snippet;
		editorArea?: Snippet;
	}

	let {
		editorRef = $bindable(null),
		placeholder = "",
		isEmpty = true,
		ariaLabel = "",
		submitIntent = "send",
		submitDisabled = false,
		submitAriaLabel = "Send message",
		onSubmit,
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
		leading,
		trailing,
		editorArea,
	}: Props = $props();

	const showStop = $derived(submitIntent === "stop" || submitIntent === "steer");
</script>

<div class="flex flex-col gap-0.5 min-w-0">
	<div class="relative min-w-0">
		{#if editorArea}
			{@render editorArea()}
		{:else}
			<!-- svelte-ignore a11y_mouse_events_have_key_events -->
			<div
				bind:this={editorRef}
				role="textbox"
				aria-multiline="true"
				aria-label={ariaLabel || placeholder}
				tabindex="0"
				contenteditable="true"
				autocapitalize="off"
				spellcheck={false}
				class="min-h-6 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words pl-1 pt-1 text-sm leading-snug text-foreground outline-none"
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
			{#if isEmpty}
				<div
					class="pointer-events-none absolute left-1 top-1 text-sm leading-snug text-muted-foreground select-none"
				>
					{placeholder}
				</div>
			{/if}
		{/if}
	</div>
	<div class="flex items-end justify-between gap-1 min-w-0">
		<div class="flex items-end gap-0.5 shrink-0">
			{#if leading}
				{@render leading()}
			{/if}
		</div>
		<div class="flex items-end gap-2 shrink-0">
			{#if trailing}
				{@render trailing()}
			{/if}
			{#if showStop}
				<Button
					type="button"
					size="icon"
					onclick={onSubmit}
					disabled={submitDisabled}
					class="h-7 w-7 cursor-pointer shrink-0 rounded-lg bg-foreground text-background hover:bg-foreground/85"
				>
					<Stop weight="fill" class="h-3.5 w-3.5" />
					<span class="sr-only">{submitAriaLabel}</span>
				</Button>
			{:else}
				<Button
					type="button"
					size="icon"
					onclick={onSubmit}
					disabled={submitDisabled}
					class="h-7 w-7 cursor-pointer shrink-0 rounded-lg bg-foreground text-background hover:bg-foreground/85"
				>
					<IconArrowUp class="h-3.5 w-3.5" />
					<span class="sr-only">{submitAriaLabel}</span>
				</Button>
			{/if}
		</div>
	</div>
</div>
