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
		d="M2.5 4.25C2.5 2.95 4.92 2 8 2C11.08 2 13.5 2.95 13.5 4.25V11.75C13.5 13.05 11.08 14 8 14C4.92 14 2.5 13.05 2.5 11.75V4.25ZM3.85 4.25C3.85 4.83 5.42 5.55 8 5.55C10.58 5.55 12.15 4.83 12.15 4.25C12.15 3.67 10.58 2.95 8 2.95C5.42 2.95 3.85 3.67 3.85 4.25ZM3.85 6.23V8.18C4.75 8.78 6.26 9.1 8 9.1C9.74 9.1 11.25 8.78 12.15 8.18V6.23C11.17 6.82 9.67 7.15 8 7.15C6.33 7.15 4.83 6.82 3.85 6.23ZM3.85 9.85V11.75C3.85 12.33 5.42 13.05 8 13.05C10.58 13.05 12.15 12.33 12.15 11.75V9.85C11.17 10.44 9.67 10.77 8 10.77C6.33 10.77 4.83 10.44 3.85 9.85Z"
		fill="currentColor"
	/>
</svg>
