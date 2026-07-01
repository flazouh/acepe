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
	fill="currentColor"
	xmlns="http://www.w3.org/2000/svg"
>
	<circle cx="8" cy="3.5" r="1.15" />
	<circle cx="8" cy="8" r="1.15" />
	<circle cx="8" cy="12.5" r="1.15" />
</svg>
