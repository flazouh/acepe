<script lang="ts">
	interface Props {
		fileName: string;
		gitStatus: { status: string; insertions: number; deletions: number } | null;
	}

	let { fileName, gitStatus }: Props = $props();
</script>

<div data-testid="file-panel-header-stub">
	<span data-testid="file-name">{fileName}</span>
	<span data-testid="insertions">{gitStatus?.insertions ?? 0}</span>
	<span data-testid="deletions">{gitStatus?.deletions ?? 0}</span>
	<span data-testid="status">{gitStatus?.status ?? "none"}</span>
</div>