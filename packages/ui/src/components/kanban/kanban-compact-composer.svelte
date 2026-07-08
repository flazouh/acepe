<script lang="ts">
	import type { Snippet } from "svelte";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		/** Current mode id used to pick the icon (e.g. "code", "plan", "build"). */
		modeLabel: string;
		/** Current input value. */
		value: string;
		/** Placeholder text for the input. */
		placeholder?: string;
		/** Whether the whole composer is disabled. */
		disabled?: boolean;
		/** Fires when the user types in the input. */
		onInput: (value: string) => void;
		/** Fires when the user presses Enter (without Shift). */
		onSubmit: () => void;
		/** Fires on keydown inside the input — use to forward voice hold keys. */
		onKeydown?: (event: KeyboardEvent) => void;
		/** Fires on keyup inside the input — use to forward voice hold release. */
		onKeyup?: (event: KeyboardEvent) => void;
		/** Slot for the mic button (rendered by the host). */
		micButton?: Snippet;
		/** Slot for the submit button (rendered by the host). */
		submitButton?: Snippet;
		/** Toggle between available provider modes. */
		onModeToggle?: () => void;
		/** Render without the boxed composer chrome so the footer can blend into the card edge. */
		embedded?: boolean;
		/** Swap the normal input layout for live voice content. */
		voiceMode?: boolean;
		/** Slot for the live voice waveform content. */
		voiceContent?: Snippet;
		/** Slot for the right-side voice controls, such as timer and stop button. */
		voiceTrailing?: Snippet;
	}

	let {
		modeLabel,
		value,
		placeholder = "Send a message…",
		disabled = false,
		onInput,
		onSubmit,
		onKeydown,
		onKeyup,
		micButton,
		submitButton,
		onModeToggle,
		embedded = false,
		voiceMode = false,
		voiceContent,
		voiceTrailing,
	}: Props = $props();

	const modeToggleLabel = $derived(`Switch mode from ${modeLabel}`);

	function handleKeydown(e: KeyboardEvent) {
		if (disabled) return;
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			onSubmit();
			return;
		}
		if (onKeydown) {
			onKeydown(e);
		}
	}

	function handleKeyup(e: KeyboardEvent) {
		if (onKeyup) {
			onKeyup(e);
		}
	}

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		onInput(target.value);
	}

	function handleModeToggle(event: MouseEvent): void {
		event.stopPropagation();
		if (onModeToggle) {
			onModeToggle();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex w-full min-w-0 items-center {embedded ? 'gap-1.5 bg-background/90 px-2 py-0.5' : 'gap-1.5 rounded-2xl bg-background/60 px-1.5 py-1'}"
	onclick={(e) => e.stopPropagation()}
	onkeydown={(e) => e.stopPropagation()}
	data-testid="kanban-compact-composer"
>
	{#if voiceMode}
		<div class="flex min-w-0 flex-1 items-center overflow-hidden">
			{#if voiceContent}
				{@render voiceContent()}
			{/if}
		</div>

		{#if voiceTrailing}
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{@render voiceTrailing()}
			</div>
		{/if}
	{:else}
		<!-- Mode control -->
		{#if onModeToggle}
			<button
				type="button"
				class="flex shrink-0 items-center justify-center rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
				aria-label={modeToggleLabel}
				onclick={handleModeToggle}
			>
				<RoundedIcon name="sliders" class="size-3.5" />
			</button>
		{:else}
			<span class="flex shrink-0 items-center justify-center">
				<RoundedIcon name="sliders" class="size-3.5 text-muted-foreground" />
			</span>
		{/if}

		<!-- Input -->
		<input
			type="text"
			class="min-w-0 flex-1 border-none bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
			{placeholder}
			{value}
			{disabled}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onkeyup={handleKeyup}
		/>

		<!-- Mic button slot -->
		{#if micButton}
			{@render micButton()}
		{/if}

		<!-- Submit button slot -->
		{#if submitButton}
			{@render submitButton()}
		{/if}
	{/if}
</div>
