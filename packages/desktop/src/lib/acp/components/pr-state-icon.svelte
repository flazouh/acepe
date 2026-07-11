<script lang="ts">
import { PullRequestStatusIcon } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";

interface Props {
	state: "OPEN" | "CLOSED" | "MERGED";
	size?: number;
}

let { state, size = 13 }: Props = $props();

const iconColor = $derived.by(() => {
	switch (state) {
		case "OPEN":
			return "var(--success)";
		case "MERGED":
			return Colors.purple;
		case "CLOSED":
			return "var(--destructive)";
	}
});
</script>

<PullRequestStatusIcon
	{state}
	style="width: {size}px; height: {size}px; color: {iconColor}"
/>
