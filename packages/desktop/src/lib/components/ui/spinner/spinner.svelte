<script lang="ts">
import { LoadingIcon } from "@acepe/ui";
interface Props {
	class?: string;
	style?: string;
	size?: number;
	dotSize?: number;
}

let { class: className = "", style = "", size = 24, dotSize = undefined }: Props = $props();
</script>

<LoadingIcon role="status" aria-label={"Loading"} class={className} {style} {size} {dotSize} />
