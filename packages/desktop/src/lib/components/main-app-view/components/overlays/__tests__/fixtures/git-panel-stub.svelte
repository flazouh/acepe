<script lang="ts">
interface Props {
	panelId: string;
	projectPath: string;
	projectName: string;
}

let { panelId, projectPath, projectName }: Props = $props();
</script>

<div
	data-testid="git-panel-stub"
	data-panel-id={panelId}
	data-project-path={projectPath}
	data-project-name={projectName}
></div>
