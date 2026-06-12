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
	}: Props = $props();

	const showStop = $derived(submitIntent === "stop" || submitIntent === "steer");
</script>

<div class="flex items-end gap-1.5 min-w-0">
	{#if leading}
		<div class="flex items-end gap-1 shrink-0">
			{@render leading()}
		</div>
	{/if}
	<div class="relative flex-1 min-w-0">
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
			class="min-h-7 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground outline-none"
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
				class="pointer-events-none absolute left-0 top-0 text-sm leading-relaxed text-muted-foreground select-none"
			>
				{placeholder}
			</div>
		{/if}
	</div>
	<div class="flex items-end gap-1 shrink-0">
		{#if trailing}
			{@render trailing()}
		{/if}
		{#if showStop}
			<Button
				type="button"
				size="icon"
				onclick={onSubmit}
				disabled={submitDisabled}
				class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85"
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
				class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/85"
			>
				<IconArrowUp class="h-3.5 w-3.5" />
				<span class="sr-only">{submitAriaLabel}</span>
			</Button>
		{/if}
	</div>
</div>
