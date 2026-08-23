<script lang="ts">
import {
	CommandId,
	emptyRpcSessionSnapshot,
	MessageId,
	type RpcClient,
	type RpcSessionSnapshot,
	type SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { onMount } from "svelte";

import { composeSessionStore } from "$lib/stores/session-store-compose.ts";
import AgentPanelView from "./agent-panel-view.svelte";
import { sendComposerMessage } from "./agent-panel-send.ts";

let { client, sessionId }: { client: RpcClient; sessionId: SessionId } = $props();

let snapshot = $state.raw<RpcSessionSnapshot>(emptyRpcSessionSnapshot(0));

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
		}).pipe(Effect.andThen(store.refreshSession(sessionId)))
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
		Effect.runFork(Fiber.interrupt(fiber));
	};
});
</script>

<section class="flex min-h-0 flex-1 flex-col" data-testid="agent-panel-session">
	<AgentPanelView {snapshot} />
	<form class="m-3 shrink-0" onsubmit={onComposerSubmit}>
		<input
			type="text"
			data-qa="composer-input"
			onkeydown={onComposerKeydown}
			aria-label="Message"
			class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
		/>
	</form>
</section>
