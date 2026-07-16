<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	import { getPermissionBarIconModel } from "./permission-bar-icon-model.js";

	interface Props {
		kind: string;
		color?: string;
		size?: number;
	}

	let { kind, color = "var(--primary)", size = 11 }: Props = $props();
	const icon = $derived(getPermissionBarIconModel(kind));
	const iconSize = $derived(size + icon.sizeOffset);
</script>

<HugeiconsIcon
	name={icon.name}
	class="shrink-0"
	style="width: {iconSize}px; height: {iconSize}px; color: {color};"
	data-testid={icon.testId}
/>
