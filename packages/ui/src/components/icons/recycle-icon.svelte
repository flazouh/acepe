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
		d="M8.87 2.06C10.72 2.33 12.24 3.58 12.91 5.25L13.39 4.42C13.58 4.1 13.99 3.99 14.31 4.18C14.63 4.37 14.74 4.78 14.55 5.1L13.4 7.09C13.27 7.32 13.02 7.46 12.75 7.43L10.43 7.2C10.06 7.16 9.79 6.83 9.83 6.46C9.87 6.09 10.2 5.82 10.57 5.86L11.66 5.97C11.15 4.63 9.96 3.62 8.68 3.43C8.31 3.38 8.05 3.03 8.11 2.66C8.16 2.29 8.5 2.04 8.87 2.06ZM5.1 3.34L4 3.34C3.63 3.34 3.33 3.04 3.33 2.67C3.33 2.3 3.63 2 4 2H6.29C6.56 2 6.8 2.16 6.91 2.4L7.86 4.54C8.01 4.88 7.86 5.28 7.52 5.43C7.18 5.58 6.78 5.43 6.63 5.09L6.18 4.08C5.15 4.75 4.45 5.85 4.24 7.08C4.18 7.45 3.83 7.69 3.47 7.63C3.1 7.57 2.86 7.22 2.92 6.86C3.18 5.35 3.99 4.06 5.1 3.34ZM4.43 10.08L3.86 11.08C3.67 11.4 3.26 11.51 2.94 11.32C2.62 11.13 2.51 10.72 2.7 10.4L3.85 8.41C3.98 8.18 4.24 8.04 4.5 8.07L6.82 8.3C7.19 8.34 7.46 8.67 7.42 9.04C7.38 9.41 7.05 9.68 6.68 9.64L5.63 9.54C6.24 11.1 7.78 12.1 9.5 12.1H11.66C12.03 12.1 12.33 12.4 12.33 12.77C12.33 13.14 12.03 13.44 11.66 13.44H9.5C7.25 13.44 5.28 12.12 4.43 10.08Z"
		fill="currentColor"
	/>
</svg>
