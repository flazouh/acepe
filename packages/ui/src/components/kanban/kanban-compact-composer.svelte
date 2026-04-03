<script lang="ts">
	import type { Snippet } from "svelte";
	import BuildIcon from "../icons/build-icon.svelte";
	import PlanIcon from "../icons/plan-icon.svelte";

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
	}: Props = $props();

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex items-center gap-1.5 rounded-md bg-background/60 px-1.5 py-1"
	onclick={(e) => e.stopPropagation()}
	onkeydown={(e) => e.stopPropagation()}
	data-testid="kanban-compact-composer"
>
	<!-- Mode icon -->
	<span class="flex shrink-0 items-center justify-center">
		{#if modeLabel === "plan"}
			<PlanIcon size="sm" />
		{:else if modeLabel === "build"}
			<BuildIcon size="sm" />
		{/if}
	</span>

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
</div>
