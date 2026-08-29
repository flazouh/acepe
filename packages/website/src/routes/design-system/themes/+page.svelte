<script lang="ts">
import { uiThemeFamilies } from "@acepe/ui/themes";

import DsSection from "$lib/design-system/ds-section.svelte";
import ThemePreview from "$lib/design-system/theme-preview.svelte";
</script>

<div class="flex flex-col gap-14">
	<header class="max-w-2xl">
		<h1 class="text-2xl font-medium tracking-tight">Themes</h1>
		<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
			One stylesheet, <span class="font-mono text-xs">@acepe/ui/theme.css</span>, holds every colour
			both the desktop app and this site render. A theme is two things: a family, set with
			<span class="font-mono text-xs">data-ui-theme</span>, and an appearance, set with the
			<span class="font-mono text-xs">dark</span> class. Each card below carries its own pair, so
			what you see is the real stylesheet, not a picture of it.
		</p>
	</header>

	{#each uiThemeFamilies as family (family.id)}
		<DsSection id={family.id} title={family.label} description={family.origin}>
			<div class="grid gap-4 sm:grid-cols-2">
				{#each ["light", "dark"] as const as appearance (appearance)}
					<div>
						<p class="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
							{appearance}
						</p>
						<ThemePreview {family} {appearance} />
					</div>
				{/each}
			</div>
		</DsSection>
	{/each}
</div>
