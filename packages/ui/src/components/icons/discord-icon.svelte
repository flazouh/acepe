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
		d="M5.27 3.2C6.14 2.94 7.05 2.81 8 2.81C8.95 2.81 9.86 2.94 10.73 3.2C10.91 3.25 11.06 3.38 11.15 3.55L11.45 4.12C12.28 4.38 12.93 4.71 13.39 5.1C13.49 5.19 13.57 5.3 13.61 5.42C14.12 6.91 14.31 8.42 14.18 9.94C14.16 10.14 14.05 10.32 13.88 10.42C13.18 10.84 12.5 11.25 11.86 11.77C11.72 11.88 11.55 11.93 11.38 11.92L10.58 11.84C10.35 11.82 10.14 11.69 10.03 11.48L9.8 11.06C9.22 11.18 8.62 11.24 8 11.24C7.38 11.24 6.78 11.18 6.2 11.06L5.97 11.48C5.86 11.69 5.65 11.82 5.42 11.84L4.62 11.92C4.45 11.93 4.28 11.88 4.14 11.77C3.5 11.25 2.82 10.84 2.12 10.42C1.95 10.32 1.84 10.14 1.82 9.94C1.69 8.42 1.88 6.91 2.39 5.42C2.43 5.3 2.51 5.19 2.61 5.1C3.07 4.71 3.72 4.38 4.55 4.12L4.85 3.55C4.94 3.38 5.09 3.25 5.27 3.2ZM5.95 7.03C5.49 7.03 5.14 7.45 5.14 7.97C5.14 8.49 5.49 8.91 5.95 8.91C6.4 8.91 6.76 8.49 6.76 7.97C6.76 7.45 6.4 7.03 5.95 7.03ZM10.05 7.03C9.6 7.03 9.24 7.45 9.24 7.97C9.24 8.49 9.6 8.91 10.05 8.91C10.51 8.91 10.86 8.49 10.86 7.97C10.86 7.45 10.51 7.03 10.05 7.03Z"
		fill="currentColor"
		fill-rule="evenodd"
		clip-rule="evenodd"
	/>
</svg>
