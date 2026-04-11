<!--
  AgentInputArtefactBadge - Chip showing an attached file/image in the composer.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/attachment-badge.svelte.
  Purely presentational — accepts display data and a remove callback.
-->
<script lang="ts">
	import X from "@lucide/svelte/icons/x";

	interface Props {
		displayName: string;
		extension?: string | null;
		kind?: "file" | "image" | "folder" | "other";
		truncate?: boolean;
		removeLabel?: string;
		onRemove: () => void;
	}

	let {
		displayName,
		extension = null,
		kind = "file",
		truncate = true,
		removeLabel = "Remove attachment",
		onRemove,
	}: Props = $props();

	const displayExtension = $derived(kind === "image" ? "png" : extension);
</script>

<span class="inline-flex items-center gap-1 p-1 rounded-md bg-muted border border-border text-xs">
	<span class="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-background/60 text-[8px] font-mono uppercase text-muted-foreground shrink-0">
		{displayExtension ? displayExtension.slice(0, 3) : "?"}
	</span>
	<span class="{truncate ? 'max-w-[120px] truncate' : ''} font-mono text-foreground">
		{displayName}
	</span>
	<button
		type="button"
		onclick={(e) => {
			e.stopPropagation();
			onRemove();
		}}
		class="ml-0.5 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive cursor-pointer transition-colors"
		aria-label={removeLabel}
	>
		<X class="h-3 w-3" />
	</button>
</span>
