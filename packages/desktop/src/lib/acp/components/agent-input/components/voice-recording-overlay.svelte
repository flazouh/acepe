<!--
  VoiceRecordingOverlay - Content shown during transcribing/error states.
  Replaces the editor content area (no padding from InputContainer).
-->
<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
import type { VoiceInputState } from "../state/voice-input-state.svelte.js";

function autoFocus(node: HTMLElement) {
	node.focus();
}

interface Props {
	voiceState: VoiceInputState;
}

const { voiceState }: Props = $props();

const isTranscribing = $derived(voiceState.phase === "transcribing");
const isError = $derived(voiceState.phase === "error");
</script>

<div class="flex flex-col items-center justify-center gap-3 min-h-[72px] py-4">
	{#if isTranscribing}
		<div class="flex flex-col items-center gap-2">
			<div
				class="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary"
				role="status"
				aria-label={m.voice_transcribing()}
			></div>
			<span class="text-xs text-muted-foreground">{m.voice_transcribing()}</span>
		</div>
	{:else if isError}
		<div class="flex max-w-[260px] flex-col items-center gap-2 text-center" role="alert" aria-live="assertive">
			<p class="text-sm font-medium text-foreground">
				{voiceState.errorMessage || m.voice_error_permission_denied()}
			</p>
			<button
				use:autoFocus
				class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				onclick={() => voiceState.dismissError()}
			>
				{m.common_close()}
			</button>
		</div>
	{/if}
</div>
