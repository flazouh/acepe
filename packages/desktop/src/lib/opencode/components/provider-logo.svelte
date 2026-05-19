<script lang="ts">
import { ProviderMark } from "@acepe/ui";

interface Props {
	providerId: string;
	providerName?: string;
	class?: string;
}

let { providerId, providerName, class: className }: Props = $props();
</script>

<ProviderMark brand="custom" label={providerName ?? providerId} class={className} />
