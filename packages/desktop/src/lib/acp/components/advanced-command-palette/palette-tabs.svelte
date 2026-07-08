<script lang="ts">
import { RoundedIcon } from "@acepe/ui";

import type { PaletteMode } from "../../types/palette-mode.js";

interface Props {
	/** Current active mode */
	mode: PaletteMode;
	/** Available modes with labels */
	modes: Array<{ mode: PaletteMode; label: string }>;
	/** Callback when mode changes */
	onModeChange: (mode: PaletteMode) => void;
}

let { mode, modes, onModeChange }: Props = $props();

const MODE_ICONS = {
	commands: "terminal",
	sessions: "chat",
	files: "files",
} as const;
</script>

<div class="flex items-center gap-0.5 px-2 pt-2 pb-1.5">
	{#each modes as { mode: m, label }, index (m)}
		{@const isActive = m === mode}
		{@const ModeIcon = MODE_ICONS[m]}
		<button
			type="button"
			class="group px-2 py-1 text-[11px] font-medium rounded-md transition-all duration-150 {isActive
				? 'bg-accent text-accent-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}"
			onclick={() => onModeChange(m)}
		>
			<span class="flex items-center gap-1.5">
				<RoundedIcon name={ModeIcon} class="size-3.5 transition-colors" />
				<span>{label}</span>
				<span class="text-[9px] opacity-40 font-normal ml-0.5">⌘{index + 1}</span>
			</span>
		</button>
	{/each}
</div>
