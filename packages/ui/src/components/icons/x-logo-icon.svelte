<script lang="ts">
	interface Props {
		class?: string;
		style?: string;
		size?: number;
		color?: string;
		"data-testid"?: string;
	}

	let {
		class: className,
		style,
		size,
		color,
		"data-testid": dataTestId,
	}: Props = $props();

	const resolvedClass = $derived(className ?? (size === undefined ? "size-4" : ""));
	const resolvedStyle = $derived(
		`${size === undefined ? "" : `width: ${size}px; height: ${size}px;`}${
			color === undefined ? "" : `color: ${color};`
		}${style ?? ""}`
	);
</script>

<svg
	class={resolvedClass}
	style={resolvedStyle.length === 0 ? undefined : resolvedStyle}
	data-testid={dataTestId}
	aria-hidden="true"
	viewBox="0 0 24 24"
	xmlns="http://www.w3.org/2000/svg"
>
	<path
		d="M18.244 2H21.5l-7.1 8.117L22 22h-5.956l-4.663-6.104L6.04 22H2.78l7.594-8.68L2 2h6.108l4.215 5.56L18.244 2Zm-1.143 18h1.804L5.128 3.895H3.193L17.1 20Z"
		fill="currentColor"
	/>
</svg>
