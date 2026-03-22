<script lang="ts">
interface Props {
	open: boolean;
	projectPath: string;
	projectName: string;
	onOpenChange: (open: boolean) => void;
}

let { open, projectPath, projectName }: Props = $props();
</script>

<div
	data-testid="setup-scripts-dialog-stub"
	data-open={open}
	data-project-path={projectPath}
	data-project-name={projectName}
></div>
