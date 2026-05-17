<script lang="ts">
	interface Props {
		title?: string;
		ariaLabel?: string;
		disabled?: boolean;
	}

	let { title = "control", ariaLabel = title, disabled = false }: Props = $props();
</script>

<button type="button" {title} aria-label={ariaLabel} {disabled}>control</button>
