<script lang="ts">
import {
	CommandId,
	emptyRpcSessionSnapshot,
	MessageId,
	type RpcClient,
	type RpcSessionSnapshot,
	type SessionId,
} from "@acepe/contracts";
import {
	AgentInputMicButton,
	AgentInputVoiceRecordingOverlay,
	getMicButtonVisualState,
} from "@acepe/ui";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { onMount } from "svelte";

import { handleVoiceMicKeyDown } from "$lib/acp/components/agent-input/logic/voice-mic-keyboard.js";
import { resolveVoiceMicTooltip } from "$lib/acp/components/agent-input/logic/voice-mic-labels.js";
import { VoiceInputState } from "$lib/acp/components/agent-input/state/voice-input-state.svelte.js";
import { composeSessionStore } from "$lib/stores/session-store-compose.ts";
import AgentPanelTerminalView from "./agent-panel-terminal-view.svelte";
import AgentPanelView from "./agent-panel-view.svelte";
import { sendComposerMessage } from "./agent-panel-send.ts";

let { client, sessionId }: { client: RpcClient; sessionId: SessionId } = $props();

let snapshot = $state.raw<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));
let lastSendError = $state<string | null>(null);
let composerInput = $state<HTMLInputElement | null>(null);
let terminalOpen = $state(false);

const voiceMicTooltipLabels = {
	downloadingModel: "Downloading speech model…",
	loadingModel: "Loading model...",
	checkingPermission: "Checking...",
	transcribing: "Transcribing…",
	stopRecording: "Stop recording",
	startRecording: "Start voice recording",
} as const;

const voiceState = new VoiceInputState({
	sessionId,
	onTranscriptionReady: (text) => {
		if (composerInput === null) {
			return;
		}
		const current = composerInput.value;
		composerInput.value = current.length === 0 ? text : `${current} ${text}`;
	},
});

const micTitle = $derived(resolveVoiceMicTooltip(voiceState.phase, voiceMicTooltipLabels));

const registry = AtomRegistry.make();
const store = composeSessionStore({
	get client() {
		return client;
	},
	registry,
	onSnapshot: (next) => {
		setTimeout(() => {
			snapshot = next;
		}, 0);
	},
});

const nextCommandId = (): CommandId =>
	CommandId.make(
		`message-send-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
	);

const nextMessageId = (): MessageId =>
	MessageId.make(`message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const submitFromInput = (input: HTMLInputElement) => {
	const text = input.value;
	Effect.runFork(
		sendComposerMessage({
			sessionId,
			text,
			commandId: nextCommandId(),
			messageId: nextMessageId(),
		}).pipe(
			Effect.andThen(store.followSession(sessionId)),
			// A send that fails after the engine persisted looks like "nothing
			// happened" in the UI. Surface the cause where QA can read it.
			Effect.tapCause((cause) =>
				Effect.sync(() => {
					lastSendError = String(cause).slice(0, 300);
				}),
			),
		)
	);
	input.value = "";
};

const inputFromEventTarget = (target: EventTarget | null): HTMLInputElement | null => {
	if (target instanceof HTMLInputElement) {
		return target;
	}
	if (target instanceof HTMLFormElement) {
		const found = target.querySelector("[data-qa='composer-input']");
		if (found instanceof HTMLInputElement) {
			return found;
		}
	}
	return null;
};

const onComposerKeydown = (event: KeyboardEvent) => {
	if (event.key !== "Enter" || event.shiftKey) {
		return;
	}
	event.preventDefault();
	const input = inputFromEventTarget(event.currentTarget) ?? inputFromEventTarget(event.target);
	if (input !== null) {
		submitFromInput(input);
	}
};

const onComposerSubmit = (event: SubmitEvent) => {
	event.preventDefault();
	const input = inputFromEventTarget(event.currentTarget);
	if (input !== null) {
		submitFromInput(input);
	}
};

onMount(() => {
	const fiber = Effect.runFork(store.openSession(sessionId));
	return () => {
		voiceState.dispose();
		Effect.runFork(Fiber.interrupt(fiber));
	};
});
</script>

<section
	class="flex min-h-0 flex-1 flex-col"
	data-testid="agent-panel-session"
	data-qa-snapshot-rows={snapshot.messages.length}
	data-qa-snapshot-seq={snapshot.snapshotSequence}
	data-qa-send-error={lastSendError ?? ""}
	data-voice-phase={voiceState.phase}
	data-voice-error={voiceState.errorMessage ?? ""}
>
	<AgentPanelView {snapshot} />
	{#if terminalOpen}
		<div class="m-3 h-64 shrink-0 overflow-hidden rounded-lg border border-border/60">
			{#key sessionId}
				<AgentPanelTerminalView {client} {sessionId} />
			{/key}
		</div>
	{/if}
	<form class="m-3 flex shrink-0 items-center gap-2" onsubmit={onComposerSubmit}>
		<button
			type="button"
			data-qa="terminal-toggle"
			aria-pressed={terminalOpen}
			title={terminalOpen ? "Hide terminal" : "Show terminal"}
			onclick={() => {
				terminalOpen = !terminalOpen;
			}}
			class="shrink-0 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
		>
			{terminalOpen ? "Hide terminal" : "Terminal"}
		</button>
		<input
			bind:this={composerInput}
			type="text"
			data-qa="composer-input"
			onkeydown={onComposerKeydown}
			aria-label="Message"
			class="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
		/>
		<AgentInputMicButton
			visualState={getMicButtonVisualState(voiceState.phase)}
			downloadPercent={voiceState.downloadPercent}
			title={micTitle}
			ariaLabel={micTitle}
			onpointerdown={(event) => {
				voiceState.onMicPointerDown(event);
			}}
			onpointerup={() => {
				voiceState.onMicPointerUp();
			}}
			onpointercancel={() => {
				voiceState.onMicPointerCancel();
			}}
			onkeydown={(event) => {
				handleVoiceMicKeyDown(event, voiceState);
			}}
		/>
	</form>
	{#if voiceState.phase === "error"}
		<div class="px-3 pb-3">
			<AgentInputVoiceRecordingOverlay phase="error" errorMessage={voiceState.errorMessage} />
		</div>
	{/if}
</section>
