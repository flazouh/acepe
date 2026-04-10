<script lang="ts">
interface Props {
	filePath: string;
	linesAdded: number;
	linesRemoved: number;
	selected?: boolean;
}

let { filePath, linesAdded, linesRemoved, selected = false }: Props = $props();
</script>

<div data-testid="file-path-badge" data-selected={selected}>
	{filePath}:{linesAdded}:{linesRemoved}
</div>