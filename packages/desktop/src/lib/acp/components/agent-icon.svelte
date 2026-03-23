<script lang="ts">
import { useTheme } from "$lib/components/theme/context.svelte.js";

import { getAgentIcon } from "../constants/thread-list-constants.js";

interface Props {
	agentId: string;
	class?: string;
	size?: number;
}

let { agentId, class: className = "", size = 16 }: Props = $props();

const themeState = useTheme();

// Get the correct icon path based on current theme
const iconPath = $derived(getAgentIcon(agentId, themeState.effectiveTheme));
</script>

<img src={iconPath} alt={agentId} class={className} width={size} height={size} />
