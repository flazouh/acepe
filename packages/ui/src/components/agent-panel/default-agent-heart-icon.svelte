<script lang="ts">
	interface Props {
		filled?: boolean;
		class?: string;
		"data-testid"?: string;
	}

	let {
		filled = false,
		class: className = "",
		"data-testid": dataTestId,
	}: Props = $props();
</script>

<svg
	class="default-agent-heart-icon {className}"
	data-testid={dataTestId ?? (filled ? "default-agent-heart-filled-icon" : "default-agent-heart-outline-icon")}
	aria-hidden="true"
	viewBox="0 0 16 16"
	xmlns="http://www.w3.org/2000/svg"
>
	{#if filled}
		<path
			d="M8 13.35L7.17 12.6C4.08 9.8 2.25 8.14 2.25 6.08C2.25 4.39 3.56 3.08 5.22 3.08C6.15 3.08 7.06 3.51 7.66 4.2L8 4.6L8.34 4.2C8.94 3.51 9.85 3.08 10.78 3.08C12.44 3.08 13.75 4.39 13.75 6.08C13.75 8.14 11.92 9.8 8.83 12.6L8 13.35Z"
			fill="currentColor"
		/>
	{:else}
		<path
			d="M8 13.25L7.19 12.52C4.15 9.76 2.45 8.2 2.45 6.18C2.45 4.72 3.58 3.58 5.04 3.58C5.86 3.58 6.66 3.97 7.18 4.58L8 5.55L8.82 4.58C9.34 3.97 10.14 3.58 10.96 3.58C12.42 3.58 13.55 4.72 13.55 6.18C13.55 8.2 11.85 9.76 8.81 12.52L8 13.25Z"
			fill="none"
			stroke="currentColor"
			stroke-width="1.35"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{/if}
</svg>

<style>
	.default-agent-heart-icon {
		display: block;
		height: 14px;
		width: 14px;
		overflow: visible;
	}
</style>
