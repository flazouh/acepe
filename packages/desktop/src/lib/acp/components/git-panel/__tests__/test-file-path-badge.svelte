<script lang="ts">
interface Props {
	filePath: string;
}

let { filePath }: Props = $props();
</script>

<span>{filePath}</span>
