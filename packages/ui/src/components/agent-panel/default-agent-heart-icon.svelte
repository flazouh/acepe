<script lang="ts">
	import { HugeiconsIcon } from "../icons/index.js";
	interface Props {
		filled?: boolean;
		class?: string;
		"data-testid"?: string;
	}

	let {
		filled = false,
		class: className = "",
		"data-testid": dataTestId,
	}: Props = $props();
</script>

<HugeiconsIcon
	name={filled ? "heart-filled" : "heart"}
	class="size-3.5 {className}"
	data-testid={dataTestId ?? (filled ? "default-agent-heart-filled-icon" : "default-agent-heart-outline-icon")}
/>
