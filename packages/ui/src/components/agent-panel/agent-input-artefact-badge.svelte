<!--
  AgentInputArtefactBadge - Chip showing an attached file/image in the composer.

  Extracted from packages/desktop/src/lib/acp/components/agent-input/components/attachment-badge.svelte.
  Purely presentational — accepts display data and a remove callback.
-->
<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";

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

<span class="inline-flex items-center gap-1 rounded-md border border-border bg-muted p-1 text-xs">
	<span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-md bg-background/60 text-[8px] font-mono uppercase text-muted-foreground">
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
		class="ml-0.5 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
		aria-label={removeLabel}
	>
		<HugeiconsIcon name="close" class="h-3 w-3" />
	</button>
</span>
