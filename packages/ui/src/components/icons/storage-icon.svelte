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
		d="M3.5 2.5H12.5C13.33 2.5 14 3.17 14 4V5.25C14 5.86 13.64 6.38 13.12 6.62C13.64 6.86 14 7.39 14 8V9.25C14 9.86 13.64 10.38 13.12 10.62C13.64 10.86 14 11.39 14 12V13.25C14 14.08 13.33 14.75 12.5 14.75H3.5C2.67 14.75 2 14.08 2 13.25V12C2 11.39 2.36 10.86 2.88 10.62C2.36 10.38 2 9.86 2 9.25V8C2 7.39 2.36 6.86 2.88 6.62C2.36 6.38 2 5.86 2 5.25V4C2 3.17 2.67 2.5 3.5 2.5ZM3.35 4V5.25C3.35 5.33 3.42 5.4 3.5 5.4H12.5C12.58 5.4 12.65 5.33 12.65 5.25V4C12.65 3.92 12.58 3.85 12.5 3.85H3.5C3.42 3.85 3.35 3.92 3.35 4ZM3.35 8V9.25C3.35 9.33 3.42 9.4 3.5 9.4H12.5C12.58 9.4 12.65 9.33 12.65 9.25V8C12.65 7.92 12.58 7.85 12.5 7.85H3.5C3.42 7.85 3.35 7.92 3.35 8ZM3.35 12V13.25C3.35 13.33 3.42 13.4 3.5 13.4H12.5C12.58 13.4 12.65 13.33 12.65 13.25V12C12.65 11.92 12.58 11.85 12.5 11.85H3.5C3.42 11.85 3.35 11.92 3.35 12Z"
		fill="currentColor"
	/>
	<path d="M4.7 4.45H5.7V4.8H4.7V4.45Z" fill="currentColor" />
	<path d="M4.7 8.45H5.7V8.8H4.7V8.45Z" fill="currentColor" />
	<path d="M4.7 12.45H5.7V12.8H4.7V12.45Z" fill="currentColor" />
</svg>
