<script lang="ts">
	interface Props {
		panelId: string;
		filePath: string;
		projectPath: string;
		projectName: string;
		width: number;
	}

	let { panelId, filePath, projectPath, projectName, width }: Props = $props();
</script>

<div data-testid="attached-file-panel">
	{panelId}:{filePath}:{projectPath}:{projectName}:{width}
</div>