<script lang="ts">
	interface Props {
		filePath: string | null;
		fileName: string | null;
		additions: number;
		deletions: number;
		status: "running" | "done" | "error";
		interactive?: boolean;
		onSelect?: (() => void) | undefined;
	}

	let { filePath, fileName, additions, deletions, status, interactive = false, onSelect }: Props =
		$props();
</script>

<button type="button" data-testid="agent-tool-read" data-interactive={interactive} onclick={() => onSelect?.()}>
	<span data-testid="file-path">{filePath}</span>
	<span data-testid="file-name">{fileName}</span>
	<span data-testid="additions">{additions}</span>
	<span data-testid="deletions">{deletions}</span>
	<span data-testid="status">{status}</span>
</button>