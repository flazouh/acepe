<script lang="ts">
import ColorSwatch from "$lib/design-system/color-swatch.svelte";
import DsSection from "$lib/design-system/ds-section.svelte";
import { colorGroups } from "$lib/design-system/tokens.js";
</script>

<div class="flex flex-col gap-14">
	<header class="max-w-2xl">
		<h1 class="text-2xl font-medium tracking-tight">Palette</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			Every colour in Acepe is a semantic token, never a raw hex. Components ask for a role
			(<span class="font-mono text-xs">--card</span>,
			<span class="font-mono text-xs">--destructive</span>) and the active theme decides the value.
			The swatches below read their value from the live document, so they always show what the
			stylesheet really resolves to. Flip the theme in the header and watch them change.
		</p>
	</header>

	{#each colorGroups as group (group.id)}
		<DsSection id={group.id} title={group.title} description={group.description}>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
				{#each group.tokens as token (token.name)}
					<ColorSwatch {token} />
				{/each}
			</div>
		</DsSection>
	{/each}

	<DsSection
		id="pairing"
		title="Pairing rules"
		description="A fill token and its foreground token are a pair. Using one without the other is how contrast breaks."
	>
		<div class="overflow-hidden rounded-lg border border-border/60 bg-card">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-border/40 bg-muted/20 text-left">
						<th class="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Fill
						</th>
						<th class="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Text on it
						</th>
						<th class="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
							Preview
						</th>
					</tr>
				</thead>
				<tbody>
					{#each colorGroups.flatMap((group) => group.tokens).filter((token) => token.on) as token (token.name)}
						<tr class="border-b border-border/20 last:border-b-0">
							<td class="px-4 py-2.5 font-mono text-xs">--{token.name}</td>
							<td class="px-4 py-2.5 font-mono text-xs text-muted-foreground">--{token.on}</td>
							<td class="px-4 py-2.5">
								<span
									class="inline-flex items-center rounded-md px-2.5 py-1 text-xs"
									style:background-color="var(--{token.name})"
									style:color="var(--{token.on})"
								>
									Sample text
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</DsSection>
</div>
