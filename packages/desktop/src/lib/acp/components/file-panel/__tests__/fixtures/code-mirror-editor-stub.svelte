<script lang="ts">
	interface Props {
		value: string;
		language?: string;
		readonly?: boolean;
		gitGutterInput?: { kind: string } | null;
	}

	let { value, language = "", readonly = false, gitGutterInput = null }: Props = $props();
</script>

<div
	data-testid="code-editor-stub"
	data-language={language}
	data-readonly={readonly}
	data-gutter-kind={gitGutterInput?.kind ?? "none"}
>
	{value}
</div>