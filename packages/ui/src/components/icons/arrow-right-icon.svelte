<script lang="ts">
	import RoundedIcon from "./rounded-icon.svelte";

	interface Props {
		size?: "sm" | "md" | "lg";
		class?: string;
	}

	let { size = "md", class: className }: Props = $props();

	const sizeMap = {
		sm: 12,
		md: 14,
		lg: 18,
	};

	const iconStyle = $derived(`width: ${sizeMap[size]}px; height: ${sizeMap[size]}px;`);
	const iconClass = $derived(`rotate-180 ${className ?? ""}`);
</script>

<RoundedIcon name="arrow-left" class={iconClass} style={iconStyle} />
