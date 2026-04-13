<!--
  ConnectionErrorUI - Error panel shown when agent connection fails.

  Uses splash-style background (grain gradient shader) with centered embedded card.
  Matches plan dialog, agent panel header/footer, and create plan card design.
-->
<script lang="ts">
import { BrandShaderBackground } from "@acepe/ui";
import { EmbeddedIconButton, EmbeddedPanelHeader, HeaderTitleCell } from "@acepe/ui/panel-header";
import { Colors } from "@acepe/ui/colors";
import { ArrowsClockwise } from "phosphor-svelte";
import { WarningCircle } from "phosphor-svelte";
import * as m from "$lib/messages.js";

interface Props {
	error: string;
	onRetry: () => void;
	onCancel: () => void;
}

let { error, onRetry, onCancel }: Props = $props();
</script>

<div class="relative h-full min-h-0 overflow-hidden">
	<!-- Shader background layer -->
	<BrandShaderBackground />

	<!-- Content layer: centered card -->
	<div
		class="absolute inset-0 z-10 flex items-center justify-center px-6"
	>
		<div
			class="w-full max-w-lg flex flex-col rounded-xl border border-border/40 bg-background overflow-hidden shadow-xl"
			role="alert"
			aria-labelledby="connection-error-title"
		>
		<!-- Header -->
		<EmbeddedPanelHeader class="bg-muted/10 border-border/30">
			<div class="flex items-center h-full border-r border-border/50 shrink-0">
				<EmbeddedIconButton ariaLabel="Error" class="pointer-events-none" style="color: {Colors.red}">
					<WarningCircle class="h-3.5 w-3.5" weight="fill" />
				</EmbeddedIconButton>
			</div>
			<HeaderTitleCell compactPadding>
				<span
					id="connection-error-title"
					class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none"
				>
					{m.connection_error_title()}
				</span>
			</HeaderTitleCell>
		</EmbeddedPanelHeader>

		<!-- Content -->
		<div class="flex flex-col gap-4 px-5 py-5">
			<p class="text-sm text-muted-foreground leading-relaxed">
				{m.connection_error_description()}
			</p>

			<details class="group">
				<summary class="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground transition-colors list-none">
					<span class="inline-flex items-center gap-1">
						<span class="group-open:rotate-90 transition-transform">▶</span>
						{m.connection_error_details()}
					</span>
				</summary>
				<div
					class="mt-2 rounded-md border border-border/50 bg-muted/20 p-3 text-xs font-mono text-muted-foreground break-words"
				>
					{error}
				</div>
			</details>
		</div>

		<!-- Footer -->
		<div class="shrink-0 flex items-center h-7 border-t border-border/50 px-2 gap-1 justify-end">
			<button
				type="button"
				onclick={onCancel}
				class="h-5 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
			>
				{m.common_cancel()}
			</button>
			<button
				type="button"
				onclick={onRetry}
				class="h-5 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
			>
				<ArrowsClockwise class="h-3 w-3" weight="fill" />
				{m.connection_error_retry()}
			</button>
		</div>
		</div>
	</div>
</div>
