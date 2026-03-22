<script lang="ts">
import { LoadingIcon } from "@acepe/ui";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	class?: string;
	style?: string;
}

let { class: className = "", style = "" }: Props = $props();
</script>

<LoadingIcon role="status" aria-label={m.aria_loading()} class={className} {style} />
