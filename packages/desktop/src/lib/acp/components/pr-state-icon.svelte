<script lang="ts">
import { RoundedIcon, type RoundedIconName } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import type { PrState } from "$lib/utils/tauri-client/git.js";

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

const iconName = $derived<RoundedIconName>(
	state === "MERGED" ? "pull-request-merged" : state === "CLOSED" ? "pull-request-closed" : "pull-request"
);
</script>

<RoundedIcon
	name={iconName}
	style="width: {size}px; height: {size}px; color: {iconColor}"
/>
