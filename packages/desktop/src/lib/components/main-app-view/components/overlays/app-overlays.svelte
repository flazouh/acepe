<script lang="ts">
import { AdvancedCommandPalette } from "$lib/acp/components/advanced-command-palette/index.js";
import { DebugPanel } from "$lib/acp/components/index.js";
import type { UseAdvancedCommandPalette } from "$lib/acp/hooks/use-advanced-command-palette.svelte.js";
import ErrorBoundary from "$lib/components/error-boundary.svelte";
import SkillsManagerDialog from "$lib/skills/components/skills-manager-dialog.svelte";

import type { MainAppViewState } from "../../logic/main-app-view-state.svelte.js";

interface Props {
	state: MainAppViewState;
	commandPalette: UseAdvancedCommandPalette;
}

let { state, commandPalette }: Props = $props();
</script>

<AdvancedCommandPalette
	bind:open={state.commandPaletteOpen}
	{commandPalette}
	onOpenChange={(open) => {
		state.commandPaletteOpen = open;
	}}
/>
<DebugPanel bind:open={state.debugPanelOpen} />
<SkillsManagerDialog bind:open={state.skillsManagerOpen} />

{#if state.initializationError}
	<ErrorBoundary
		error={state.initializationError}
		reset={() => {
			state.initializationError = null;
		}}
	/>
{/if}
