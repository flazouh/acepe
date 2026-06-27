<script lang="ts">
import { NOTION_ICON_SVGS } from "./notion-icons.generated.js";

interface Props {
	notion: string;
	size?: number | string;
	class?: string;
	[key: string]: unknown;
}

let { notion, size = 16, class: className = "" }: Props = $props();
const svg = $derived(NOTION_ICON_SVGS[notion] ?? NOTION_ICON_SVGS.square ?? "");
const px = $derived(typeof size === "number" ? `${size}px` : size);
</script>

<span
	class={`notion-glyph ${className}`}
	style:width={px}
	style:height={px}
	style:display="inline-flex"
	aria-hidden="true"
>{@html svg}</span>

<style>
	.notion-glyph :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
