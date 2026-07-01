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
		d="M7.33 2.18C7.33 1.81 7.63 1.51 8 1.51C8.37 1.51 8.67 1.81 8.67 2.18V3.1H10.75C12.27 3.1 13.5 4.33 13.5 5.85V10.25C13.5 11.77 12.27 13 10.75 13H5.25C3.73 13 2.5 11.77 2.5 10.25V5.85C2.5 4.33 3.73 3.1 5.25 3.1H7.33V2.18ZM5.25 4.45C4.48 4.45 3.85 5.08 3.85 5.85V10.25C3.85 11.02 4.48 11.65 5.25 11.65H10.75C11.52 11.65 12.15 11.02 12.15 10.25V5.85C12.15 5.08 11.52 4.45 10.75 4.45H5.25Z"
		fill="currentColor"
	/>
	<path d="M5.65 7.55C5.65 7.08 6.03 6.7 6.5 6.7C6.97 6.7 7.35 7.08 7.35 7.55C7.35 8.02 6.97 8.4 6.5 8.4C6.03 8.4 5.65 8.02 5.65 7.55Z" fill="currentColor" />
	<path d="M8.65 7.55C8.65 7.08 9.03 6.7 9.5 6.7C9.97 6.7 10.35 7.08 10.35 7.55C10.35 8.02 9.97 8.4 9.5 8.4C9.03 8.4 8.65 8.02 8.65 7.55Z" fill="currentColor" />
	<path d="M6.1 9.78C6.1 9.45 6.37 9.18 6.7 9.18H9.3C9.63 9.18 9.9 9.45 9.9 9.78C9.9 10.11 9.63 10.38 9.3 10.38H6.7C6.37 10.38 6.1 10.11 6.1 9.78Z" fill="currentColor" />
	<path d="M1.35 7.1C1.35 6.73 1.65 6.43 2.02 6.43H2.65V9.65H2.02C1.65 9.65 1.35 9.35 1.35 8.98V7.1Z" fill="currentColor" />
	<path d="M13.35 6.43H13.98C14.35 6.43 14.65 6.73 14.65 7.1V8.98C14.65 9.35 14.35 9.65 13.98 9.65H13.35V6.43Z" fill="currentColor" />
</svg>
