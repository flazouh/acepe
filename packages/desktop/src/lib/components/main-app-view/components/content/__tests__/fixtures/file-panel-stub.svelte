<script lang="ts">
interface Props {
	panelId: string;
	filePath: string;
	projectPath: string;
	projectName: string;
	width: number;
	initialGitStatus?: { status: string; insertions: number; deletions: number } | null;
}

let {
	panelId,
	filePath,
	projectPath,
	projectName,
	width,
	initialGitStatus = null,
}: Props = $props();
</script>

<div data-testid="attached-file-panel">
	{panelId}:{filePath}:{projectPath}:{projectName}:{width}:{initialGitStatus?.insertions ?? 0}:{initialGitStatus?.deletions ?? 0}
</div>
