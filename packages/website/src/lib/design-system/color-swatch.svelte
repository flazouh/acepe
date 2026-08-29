<script lang="ts">
import { liveToken } from "./live-token.svelte.js";
import type { TokenEntry } from "./tokens.js";

interface Props {
	token: TokenEntry;
}

let { token }: Props = $props();

const value = $derived(liveToken(token.name));
const foreground = $derived(token.on ? `var(--${token.on})` : "var(--foreground)");
</script>

<div class="overflow-hidden rounded-lg border border-border/60 bg-card">
	<div
		class="flex h-20 items-end px-3 py-2"
		style:background-color="var(--{token.name})"
		style:color={foreground}
	>
		{#if token.on}
			<span class="text-xs font-medium">Aa</span>
		{/if}
	</div>
	<div class="border-t border-border/40 px-3 py-2.5">
		<p class="font-mono text-[11px] font-medium text-foreground">--{token.name}</p>
		<p class="mt-0.5 font-mono text-[10px] text-muted-foreground">{value || "—"}</p>
		<p class="mt-1.5 text-[11px] leading-snug text-muted-foreground">{token.usage}</p>
	</div>
</div>
