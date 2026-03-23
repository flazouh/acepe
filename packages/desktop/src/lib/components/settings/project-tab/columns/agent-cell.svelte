<script lang="ts">
import { getAgentIcon } from "$lib/acp/constants/thread-list-constants.js";
import { capitalizeName } from "$lib/acp/utils/index.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";

interface Props {
	agentId: string;
}

let { agentId }: Props = $props();

const themeState = useTheme();
const iconSrc = $derived(getAgentIcon(agentId, themeState.effectiveTheme));
const displayName = $derived(capitalizeName(agentId));
</script>

<img src={iconSrc} alt={displayName} title={displayName} class="h-4 w-4" />
