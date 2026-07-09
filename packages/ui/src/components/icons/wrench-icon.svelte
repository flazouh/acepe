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
		d="M10.42 1.82C11.2 1.55 12.1 1.65 12.84 2.09L10.63 4.3L11.7 5.37L13.91 3.16C14.35 3.9 14.45 4.8 14.18 5.58C13.82 6.64 12.88 7.36 11.82 7.48L6.67 12.63C6.03 13.27 5 13.27 4.36 12.63L3.37 11.64C2.73 11 2.73 9.97 3.37 9.33L8.52 4.18C8.64 3.12 9.36 2.18 10.42 1.82ZM5.18 11.81C5.37 12 5.66 12 5.85 11.81L10.94 6.72C11.08 6.58 11.28 6.5 11.48 6.5C12.24 6.5 12.92 6.02 13.16 5.3L11.7 6.76L9.24 4.3L10.7 2.84C9.98 3.08 9.5 3.76 9.5 4.52C9.5 4.72 9.42 4.92 9.28 5.06L4.19 10.15C4 10.34 4 10.63 4.19 10.82L5.18 11.81Z"
		fill="currentColor"
	/>
	<path
		d="M5.08 10.39C5.37 10.1 5.84 10.1 6.13 10.39C6.42 10.68 6.42 11.15 6.13 11.44C5.84 11.73 5.37 11.73 5.08 11.44C4.79 11.15 4.79 10.68 5.08 10.39Z"
		fill="currentColor"
	/>
</svg>
