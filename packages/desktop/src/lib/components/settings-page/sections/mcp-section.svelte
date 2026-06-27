<script lang="ts">
import { CheckCircle, Plugs, WarningCircle } from "phosphor-svelte";
import SettingsSection from "../settings-section.svelte";
import { BUILT_IN_MCP_TOOLS } from "./mcp-section.logic.js";
</script>

<div class="w-full space-y-8">
	<SettingsSection
		title="Built-in tools"
		description="Acepe-owned MCP tools that are attached by the app, not by user config files."
	>
		<div
			class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 py-2 text-[12px] font-medium text-muted-foreground"
		>
			<span>Tool</span>
			<span>Command</span>
			<span class="text-right">Status</span>
		</div>

		{#each BUILT_IN_MCP_TOOLS as tool (tool.id)}
			<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 py-3">
				<div class="flex min-w-0 items-center gap-2">
					<Plugs class="size-3.5 shrink-0 text-muted-foreground" weight="regular" />
					<div class="min-w-0">
						<div class="truncate text-[12px] font-medium text-foreground">{tool.name}</div>
						<div class="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/60">
							{tool.description}
						</div>
					</div>
				</div>

				<code class="truncate rounded border border-border/50 bg-muted/30 px-1.5 py-1 text-[11px]">
					{tool.command}
				</code>

				<div
					class="flex items-center justify-end gap-1.5 text-[12px] font-medium text-muted-foreground"
					aria-label="{tool.name} status"
				>
					<CheckCircle class="size-3.5 text-emerald-500" weight="regular" />
					<span>{tool.statusLabel}</span>
				</div>
			</div>

			<div
				class="flex items-start gap-2 border-t border-border/50 py-3 text-[12px] text-muted-foreground/70"
			>
				<WarningCircle class="mt-0.5 size-3.5 shrink-0 text-amber-500" weight="regular" />
				<p class="leading-relaxed">{tool.limitation}</p>
			</div>
		{/each}
	</SettingsSection>

	<SettingsSection
		title="External servers"
		description="User-installed MCP server management is still planned."
	>
		<div class="py-3 text-[12px] leading-relaxed text-muted-foreground/70">
			Install, configure, and toggle external MCP servers across agents from this page in a
			future slice.
		</div>
	</SettingsSection>
</div>
