<script lang="ts">
interface Props {
	class?: string;
}

let { class: className = "" }: Props = $props();
</script>

<div class={className} data-testid="git-viewer-stub">Git viewer stub</div>
