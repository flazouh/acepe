<script lang="ts">
	interface Props {
		class?: string;
		"data-testid"?: string;
	}

	let { class: className = "size-4", "data-testid": dataTestid }: Props = $props();
</script>

<svg
	class={className}
	data-testid={dataTestid}
	aria-hidden="true"
	viewBox="0 0 16 16"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<path
		d="M3 4.25H13M3 8H13M3 11.75H13"
		stroke="currentColor"
		stroke-width="1.35"
		stroke-linecap="round"
	/>
</svg>
