<script lang="ts">
	interface Props {
		class?: string;
		"data-testid"?: string;
	}

	let { class: className = "size-3", "data-testid": dataTestId }: Props = $props();
</script>

<svg
	class={className}
	data-testid={dataTestId}
	aria-hidden="true"
	viewBox="0 0 16 16"
	xmlns="http://www.w3.org/2000/svg"
>
	<path
		d="M3.25 2.25H11.6L13.75 4.4V12.75C13.75 13.3 13.3 13.75 12.75 13.75H3.25C2.7 13.75 2.25 13.3 2.25 12.75V3.25C2.25 2.7 2.7 2.25 3.25 2.25Z"
		fill="none"
		stroke="currentColor"
		stroke-width="1.3"
		stroke-linejoin="round"
	/>
	<path
		d="M5 2.25V5.75H10.5V2.25"
		fill="none"
		stroke="currentColor"
		stroke-width="1.3"
		stroke-linejoin="round"
	/>
	<path
		d="M5.25 13.75V9.25H10.75V13.75"
		fill="none"
		stroke="currentColor"
		stroke-width="1.3"
		stroke-linejoin="round"
	/>
	<path d="M9.4 3.45H10.4V4.55H9.4V3.45Z" fill="currentColor" />
</svg>
