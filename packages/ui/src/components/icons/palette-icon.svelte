<script lang="ts">
	interface Props {
		class?: string;
		style?: string;
		size?: number;
		color?: string;
		weight?: string;
		"data-testid"?: string;
	}

	let {
		class: className,
		style,
		size,
		color,
		weight: _weight,
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
	viewBox="0 0 16 16"
	xmlns="http://www.w3.org/2000/svg"
>
	<path
		d="M8 1.75C4.52 1.75 1.75 4.2 1.75 7.3C1.75 10.38 4.24 12.9 7.37 12.9H8.25C8.63 12.9 8.94 13.21 8.94 13.59C8.94 14.16 9.42 14.62 9.99 14.49C12.46 13.94 14.25 11.86 14.25 9.24C14.25 5.1 11.57 1.75 8 1.75ZM8.25 11.55H7.37C4.96 11.55 3.1 9.65 3.1 7.3C3.1 4.99 5.19 3.1 8 3.1C10.78 3.1 12.9 5.76 12.9 9.24C12.9 10.98 11.9 12.42 10.41 13C10.16 12.14 9.3 11.55 8.25 11.55Z"
		fill="currentColor"
	/>
	<path d="M5.3 7.8C5.85 7.8 6.3 7.35 6.3 6.8C6.3 6.25 5.85 5.8 5.3 5.8C4.75 5.8 4.3 6.25 4.3 6.8C4.3 7.35 4.75 7.8 5.3 7.8Z" fill="currentColor" />
	<path d="M7.7 5.85C8.25 5.85 8.7 5.4 8.7 4.85C8.7 4.3 8.25 3.85 7.7 3.85C7.15 3.85 6.7 4.3 6.7 4.85C6.7 5.4 7.15 5.85 7.7 5.85Z" fill="currentColor" />
	<path d="M10.3 7.8C10.85 7.8 11.3 7.35 11.3 6.8C11.3 6.25 10.85 5.8 10.3 5.8C9.75 5.8 9.3 6.25 9.3 6.8C9.3 7.35 9.75 7.8 10.3 7.8Z" fill="currentColor" />
</svg>
