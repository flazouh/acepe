<script lang="ts">
	import {
		CommandId,
		MessageId,
		MessageSendCommand,
		ProjectCreateCommand,
		ProjectId,
		SessionCreateCommand,
		SessionId,
		type RpcClient,
	} from "@acepe/contracts";
	import { TracerTranscript } from "@acepe/ui/tracer-transcript";
	import * as Effect from "effect/Effect";
	import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
	import { createSessionStore } from "$lib/stores/session-store.svelte.ts";
	import { transcriptRowsFromSnapshot } from "$lib/stores/session-transcript-state.ts";

	let { client }: { client: RpcClient } = $props();

	const projectId = ProjectId.make("project-1");
	const sessionId = SessionId.make("session-1");
	const userMessageId = MessageId.make("message-user");
	const registry = AtomRegistry.make();
	const store = createSessionStore({ client, registry });
	const rows = $derived(transcriptRowsFromSnapshot(store.snapshot.current));

	const runTracer = Effect.gen(function* () {
		yield* store.dispatch(
			ProjectCreateCommand.make({
				type: "project.create",
				commandId: CommandId.make("cmd-project"),
				projectId,
				title: "Acepe",
				workspaceRoot: "/tmp/acepe",
			}),
		);
		yield* store.dispatch(
			SessionCreateCommand.make({
				type: "session.create",
				commandId: CommandId.make("cmd-session"),
				sessionId,
				projectId,
				title: "First session",
			}),
		);
		yield* store.dispatch(
			MessageSendCommand.make({
				type: "message.send",
				commandId: CommandId.make("cmd-message"),
				sessionId,
				messageId: userMessageId,
				text: "Ping",
			}),
		);
		yield* store.openSession(sessionId);
	});

	const onRun = () => {
		Effect.runFork(runTracer);
	};
</script>

<main data-testid="tracer-bullet">
	<button type="button" data-testid="tracer-run" onclick={onRun}>Run tracer bullet</button>
	<TracerTranscript rows={rows} emptyLabel="No messages yet" />
</main>
