<!--
  AgentInputComposerRow - Composer shell: editor above toolbar controls and submit.
-->
<script lang="ts">
import type { Snippet } from "svelte";

import AgentInputSubmitButton from "./agent-input-submit-button.svelte";
import type { AgentInputEnterBehavior } from "./agent-input-enter-behavior.js";
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
	enterBehavior?: AgentInputEnterBehavior;
	enterBehaviorMenuLabel?: string;
	enterQueueLabel?: string;
	enterQueueDescription?: string;
	enterSteerLabel?: string;
	enterSteerDescription?: string;
	onEnterBehaviorChange?: (behavior: AgentInputEnterBehavior) => void;
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
	enterBehavior = "queue",
	enterBehaviorMenuLabel = "Enter behavior",
	enterQueueLabel = "Queue",
	enterQueueDescription = "Runs after the agent finishes its current turn.",
	enterSteerLabel = "Steer",
	enterSteerDescription = "Interrupts now and redirects the agent immediately.",
	onEnterBehaviorChange,
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
				{enterBehavior}
				{enterBehaviorMenuLabel}
				{enterQueueLabel}
				{enterQueueDescription}
				{enterSteerLabel}
				{enterSteerDescription}
				enterBehaviorMenuMuted={isEmpty}
				{onEnterBehaviorChange}
			/>
		</div>
	</div>
</div>
