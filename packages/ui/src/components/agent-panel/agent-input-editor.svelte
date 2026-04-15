<!--
  AgentInputEditor - Contenteditable pill with submit button.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/agent-input-ui.svelte
  to make the composer UI reusable across desktop and website demos.

  Accepts all behavior via props/snippets — contains no logic, stores, or state machines.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { Stop } from "phosphor-svelte";

	import { Button } from "../button/index.js";

	export type AgentInputSubmitIntent = "send" | "steer" | "stop";

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
		/** Renders before the editor — used for attachment badges. */
		leading?: Snippet;
		/** Overlay rendered inside the editor area — used for dropdowns (slash command, file picker) and overlays. */
		overlay?: Snippet;
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
		overlay,
	}: Props = $props();

	const showStop = $derived(submitIntent === "stop" || submitIntent === "steer");
</script>

{#if leading}
	{@render leading()}
{/if}

<div class="flex gap-1.5 min-w-0">
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
	<!-- Submit button: in-flow, bottom-aligned -->
	<div class="flex items-end shrink-0">
		{#if showStop}
			<Button
				type="button"
				size="icon"
				onclick={onSubmit}
				disabled={submitDisabled}
				class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-muted-foreground text-background hover:bg-muted-foreground/80"
			>
				<Stop weight="fill" class="h-3.5 w-3.5" />
				<span class="sr-only">{submitAriaLabel}</span>
			</Button>
		{:else}
			<Button
				type="button"
				size="sm"
				onclick={onSubmit}
				disabled={submitDisabled}
				class="h-7 cursor-pointer shrink-0 rounded-full bg-muted-foreground text-background hover:bg-muted-foreground/80 px-3 text-xs font-medium"
			>
				Send
			</Button>
		{/if}
	</div>
</div>
