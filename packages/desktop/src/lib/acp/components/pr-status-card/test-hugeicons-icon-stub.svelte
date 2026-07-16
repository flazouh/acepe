<script lang="ts">
	let {
		name,
		"data-testid": dataTestid,
	}: {
		name: string;
		"data-testid"?: string;
	} = $props();
</script>

<svg data-testid={dataTestid} data-hugeicons-icon-name={name}></svg>
