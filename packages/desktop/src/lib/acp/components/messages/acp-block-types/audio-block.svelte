<script lang="ts">
interface Props {
	data: string;
	mimeType: string;
}

let { data, mimeType }: Props = $props();
</script>

<div class="space-y-1">
	<div class="text-xs text-muted-foreground">Audio ({mimeType})</div>
	<audio controls class="w-full">
		<source src={`data:${mimeType};base64,${data}`} />
	</audio>
</div>
