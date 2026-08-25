<!--
  AgentInputComposerRow - Composer shell: editor above toolbar controls and submit.
-->
<script lang="ts">
import type { Snippet } from "svelte";

import AgentInputSubmitButton from "./agent-input-submit-button.svelte";
import type { AgentInputSubmitIntent } from "./agent-input-submit-button-state.js";

interface Props {
	editorRef?: HTMLDivElement | null;
	placeholder?: string;
	isEmpty?: boolean;
	ariaLabel?: string;
	submitIntent?: AgentInputSubmitIntent;
	submitDisabled?: boolean;
	submitAriaLabel?: string;
	onSubmit?: () => void;
	enterQueueLabel?: string;
	enterQueueShortcut?: readonly string[];
	enterSteerLabel?: string;
	enterSteerShortcut?: readonly string[];
	stopLabel?: string;
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
	enterQueueLabel = "Queue",
	enterQueueShortcut = ["⌘", "Enter"],
	enterSteerLabel = "Steer",
	enterSteerShortcut = ["Enter"],
	stopLabel = "Stop",
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
				class="min-h-7 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words pl-1 pt-1 text-sm leading-snug text-foreground outline-none"
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
	<div class="flex items-end justify-between gap-1 min-w-0" data-qa="agent-input-toolbar-row">
		<div class="flex items-end gap-0.5 shrink-0">
			{#if leading}
				{@render leading()}
			{/if}
		</div>
		<div
			class="flex min-w-0 max-w-full items-end justify-end gap-0.5"
			data-qa="agent-input-submit-cluster"
		>
			{#if trailing}
				{@render trailing()}
			{/if}
			<AgentInputSubmitButton
				intent={submitIntent}
				disabled={submitDisabled}
				ariaLabel={submitAriaLabel}
				onSubmit={onSubmit}
				{enterQueueLabel}
				{enterQueueShortcut}
				{enterSteerLabel}
				{enterSteerShortcut}
				{stopLabel}
			/>
		</div>
	</div>
</div>
