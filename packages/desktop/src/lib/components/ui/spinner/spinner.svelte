<script lang="ts">
import { LoadingIcon } from "@acepe/ui";
interface Props {
	class?: string;
	style?: string;
}

let { class: className = "", style = "" }: Props = $props();
</script>

<LoadingIcon role="status" aria-label={"Loading"} class={className} {style} />
