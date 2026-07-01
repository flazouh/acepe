<script lang="ts">
	/**
	 * GitCommitComposer — dedicated commit composer using the agent input surface pattern.
	 */
	import type { Snippet } from "svelte";
	import { cn } from "../../lib/utils.js";
	import { RoundedIcon } from "../icons/index.js";
	import { InputContainer } from "../input-container/index.js";

	interface Props {
		message: string;
		onMessageChange: (message: string) => void;
		onCommit: (message: string) => void;
		onGenerate?: () => void;
		actions?: Snippet;
		micButton?: Snippet;
		generating?: boolean;
		disabled?: boolean;
		submitDisabled?: boolean;
		class?: string;
	}

	let {
		message,
		onMessageChange,
		onCommit,
		onGenerate,
		actions,
		micButton,
		generating = false,
		disabled = false,
		submitDisabled = false,
		class: className,
	}: Props = $props();

	const canCommit = $derived(message.trim().length > 0 && !disabled);

	function handleSubmit(): void {
		if (!canCommit || submitDisabled) {
			return;
		}

		onCommit(message.trim());
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canCommit) {
			event.preventDefault();
			handleSubmit();
		}
	}
</script>

<InputContainer class="flex-shrink-0 border border-border" contentClass="p-2">
	{#snippet content()}
		<div class={cn("relative min-w-0", className)}>
			<div class="absolute top-0 right-0 z-10 flex items-center gap-2">
				<button
					type="button"
					class="h-7 w-7 cursor-pointer shrink-0 rounded-full bg-foreground text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
					disabled={!canCommit || submitDisabled}
					onclick={handleSubmit}
				>
					<RoundedIcon name="arrow-up" class="mx-auto h-3.5 w-3.5" />
				</button>
			</div>
			<div class="relative flex-1 min-w-0 pr-12">
				<textarea
					class="min-h-[72px] max-h-[240px] w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
					placeholder="Commit message"
					rows={3}
					value={message}
					disabled={disabled}
					oninput={(event) => onMessageChange(event.currentTarget.value)}
					onkeydown={handleKeyDown}
				></textarea>
			</div>
		</div>
	{/snippet}
	{#snippet footer()}
		<div class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pr-2">
			{#if actions}
				{@render actions()}
			{/if}
		</div>
		<div class="flex items-center gap-1 pr-1">
			{#if onGenerate}
				<button
					type="button"
					class="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
					disabled={generating || disabled}
					title={generating ? "Generating..." : "Generate with AI"}
					onclick={onGenerate}
				>
					{#if generating}
						<RoundedIcon name="spinner" class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<RoundedIcon name="sparkle" class="h-3.5 w-3.5" />
					{/if}
				</button>
			{/if}
			{#if micButton}
				{@render micButton()}
			{/if}
		</div>
	{/snippet}
</InputContainer>
