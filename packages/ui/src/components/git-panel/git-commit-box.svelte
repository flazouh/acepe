<script lang="ts">
	/**
	 * GitCommitBox — Commit message input with commit button and AI generate button.
	 */
	import { cn } from "../../lib/utils.js";

	interface Props {
		message: string;
		onMessageChange: (message: string) => void;
		onCommit: (message: string) => void;
		onGenerate?: () => void;
		generating?: boolean;
		disabled?: boolean;
		class?: string;
	}

	let {
		message,
		onMessageChange,
		onCommit,
		onGenerate,
		generating = false,
		disabled = false,
		class: className,
	}: Props = $props();

	const canCommit = $derived(message.trim().length > 0 && !disabled);

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit) {
			e.preventDefault();
			onCommit(message.trim());
		}
	}
</script>

<div class={cn("flex flex-col gap-1.5 px-2 py-2 border-t border-border/30", className)}>
	<div class="relative">
		<textarea
			class="w-full resize-none rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-[0.8125rem] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
			placeholder="Commit message"
			rows={2}
			value={message}
			oninput={(e) => onMessageChange(e.currentTarget.value)}
			onkeydown={handleKeyDown}
		></textarea>
		{#if onGenerate}
			<button
				type="button"
				class="absolute top-1.5 right-1.5 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent/20 transition-colors disabled:opacity-30 disabled:pointer-events-none"
				disabled={generating || disabled}
				title={generating ? "Generating..." : "Generate with AI"}
				onclick={onGenerate}
			>
				{#if generating}
					<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
						<path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,176A72,72,0,1,1,200,128,72.08,72.08,0,0,1,128,200Z" opacity="0.2"/>
						<path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,16a88.1,88.1,0,0,1,88,88,8,8,0,0,1-16,0,72,72,0,0,0-72-72,8,8,0,0,1,0-16Z"/>
					</svg>
				{:else}
					<svg class="h-3.5 w-3.5" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
						<path d="M80,16a8,8,0,0,1,8-8h16a8,8,0,0,1,0,16H88A8,8,0,0,1,80,16ZM216,80a8,8,0,0,0,8-8V56a8,8,0,0,0-16,0V72A8,8,0,0,0,216,80Zm24,56H224a8,8,0,0,0,0,16h16a8,8,0,0,0,0-16Zm-64,72a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V216A8,8,0,0,0,176,208ZM40,80a8,8,0,0,0,8-8V56a8,8,0,0,0-16,0V72A8,8,0,0,0,40,80ZM216,208a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V216A8,8,0,0,0,216,208Zm24-128H224a8,8,0,0,0,0,16h16a8,8,0,0,0,0-16ZM80,240a8,8,0,0,0,8-8V216a8,8,0,0,0-16,0v16A8,8,0,0,0,80,240Zm-64-104H0a8,8,0,0,0,0,16H16a8,8,0,0,0,0-16ZM176,32a8,8,0,0,0,8-8V8a8,8,0,0,0-16,0V24A8,8,0,0,0,176,32ZM40,208a8,8,0,0,0-8,8v16a8,8,0,0,0,16,0V216A8,8,0,0,0,40,208ZM16,80H0a8,8,0,0,0,0,16H16a8,8,0,0,0,0-16Zm112,96a48,48,0,1,0-48-48A48.05,48.05,0,0,0,128,176Z"/>
					</svg>
				{/if}
			</button>
		{/if}
	</div>

	<button
		type="button"
		class={cn(
			"w-full rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-all cursor-pointer",
			canCommit
				? "bg-primary text-primary-foreground hover:opacity-90"
				: "bg-muted text-muted-foreground cursor-not-allowed",
		)}
		disabled={!canCommit}
		onclick={() => canCommit && onCommit(message.trim())}
	>
		Commit{#if !disabled && message.trim()}<span class="text-primary-foreground/60 ml-1">⌘↩</span>{/if}
	</button>
</div>
