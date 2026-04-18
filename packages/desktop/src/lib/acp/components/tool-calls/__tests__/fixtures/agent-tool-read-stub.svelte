<script lang="ts">
interface Props {
	filePath: string | null;
	fileName: string | null;
	additions: number;
	deletions: number;
	status: "running" | "done" | "error";
	sourceExcerpt?: string | null;
	sourceRangeLabel?: string | null;
	interactive?: boolean;
	onSelect?: (() => void) | undefined;
}

let {
	filePath,
	fileName,
	additions,
	deletions,
	status,
	sourceExcerpt = null,
	sourceRangeLabel = null,
	interactive = false,
	onSelect,
}: Props = $props();
</script>

<button type="button" data-testid="agent-tool-read" data-interactive={interactive} onclick={() => onSelect?.()}>
	<span data-testid="file-path">{filePath}</span>
	<span data-testid="file-name">{fileName}</span>
	<span data-testid="additions">{additions}</span>
	<span data-testid="deletions">{deletions}</span>
	<span data-testid="status">{status}</span>
	<span data-testid="source-excerpt">{sourceExcerpt}</span>
	<span data-testid="source-range">{sourceRangeLabel}</span>
</button>
