<script lang="ts">
interface Props {
	onClose: () => void;
}

let { onClose }: Props = $props();
</script>

<button type="button" title="Close browser panel" onclick={onClose}>Close</button>
