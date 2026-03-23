<script lang="ts">
interface Props {
	class?: string;
}

let { class: className = "" }: Props = $props();
</script>

<svg
	class={className}
	height="1em"
	width="1em"
	viewBox="0 0 240 300"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	aria-hidden="true"
>
	<g clip-path="url(#clip0_opencode)">
		<mask
			id="mask0_opencode"
			style="mask-type:luminance"
			maskUnits="userSpaceOnUse"
			x="0"
			y="0"
			width="240"
			height="300"
		>
			<path d="M240 0H0V300H240V0Z" fill="white" />
		</mask>
		<g mask="url(#mask0_opencode)">
			<path d="M180 240H60V120H180V240Z" fill="currentColor" />
			<path
				d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
				fill="currentColor"
				fill-opacity="0.2"
			/>
		</g>
	</g>
	<defs>
		<clipPath id="clip0_opencode">
			<rect width="240" height="300" fill="white" />
		</clipPath>
	</defs>
</svg>
