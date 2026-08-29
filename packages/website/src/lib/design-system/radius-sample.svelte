<script lang="ts">
import { themeVersion } from "./theme-version.svelte.js";
import type { TokenEntry } from "./tokens.js";

interface Props {
	token: TokenEntry;
}

let { token }: Props = $props();

let box = $state<HTMLElement | null>(null);
let measured = $state("");

/**
 * Radius steps are declared in `@theme inline`, so Tailwind inlines them into
 * the utility and never emits `--radius-sm` as a runtime property. Reading the
 * root would show nothing; measuring the rendered box shows the real value.
 */
$effect(() => {
	themeVersion();
	measured = box ? getComputedStyle(box).borderRadius : "";
});
</script>

<div class="rounded-lg border border-border/60 bg-card p-3">
	<div bind:this={box} class="h-16 border border-border bg-accent {token.utility}"></div>
	<p class="mt-2.5 font-mono text-[11px] font-medium">--{token.name}</p>
	<p class="font-mono text-[10px] text-muted-foreground">
		{token.utility} → {measured || "—"}
	</p>
	<p class="mt-1 text-[11px] leading-snug text-muted-foreground">{token.usage}</p>
</div>
