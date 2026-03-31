<script lang="ts">
	interface Props {
		content?: string;
		filePath?: string;
		projectPath?: string;
		formatKind?: string;
		gitGutterInput?: { kind: string } | null;
	}

	let {
		content = "",
		filePath = "",
		projectPath = "",
		formatKind = "",
		gitGutterInput = null,
	}: Props = $props();
</script>

<div
	data-testid="file-panel-view-stub"
	data-file-path={filePath}
	data-project-path={projectPath}
	data-format-kind={formatKind}
	data-gutter-kind={gitGutterInput?.kind ?? "none"}
>
	{content}
</div>