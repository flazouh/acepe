<script lang="ts">
interface Props {
	name: string;
	color: string;
}

let { name, color }: Props = $props();
</script>

<div class="flex items-center gap-2">
	<div class="w-2 h-2 rounded-full shrink-0" style="background-color: {color}"></div>
	<span class="truncate max-w-[180px]" title={name}>{name}</span>
</div>
