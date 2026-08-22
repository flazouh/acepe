import {
	CommandId,
	MessageId,
	MessageSendCommand,
	type OrchestrationCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionDeleteCommand,
	SessionId,
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"

import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"

export const LIBRARY_SEED_PROJECT_ID = ProjectId.make("library-project-1")
export const LIBRARY_SEED_FALLBACK_SESSION_ID = SessionId.make("library-session-fallback")
export const LIBRARY_SEED_ARTIFACT_SESSION_ID = SessionId.make("library-session-artifacts")
export const LIBRARY_SEED_ARCHIVED_SESSION_ID = SessionId.make("library-session-archived")
export const LIBRARY_SEED_DELETED_SESSION_ID = SessionId.make("library-session-deleted")

export const LIBRARY_SEED_COMMANDS: ReadonlyArray<OrchestrationCommand> = [
	ProjectCreateCommand.make({
		type: "project.create",
		commandId: CommandId.make("seed-library-project"),
		projectId: LIBRARY_SEED_PROJECT_ID,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe",
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("seed-library-session-fallback"),
		sessionId: LIBRARY_SEED_FALLBACK_SESSION_ID,
		projectId: LIBRARY_SEED_PROJECT_ID,
		title: "New session",
	}),
	MessageSendCommand.make({
		type: "message.send",
		commandId: CommandId.make("seed-library-message-fallback"),
		sessionId: LIBRARY_SEED_FALLBACK_SESSION_ID,
		messageId: MessageId.make("seed-library-message-fallback"),
		text: "Fix the auth bug",
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("seed-library-session-artifacts"),
		sessionId: LIBRARY_SEED_ARTIFACT_SESSION_ID,
		projectId: LIBRARY_SEED_PROJECT_ID,
		title: "@[file:/src/app.ts] Ship the slice",
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("seed-library-session-archived"),
		sessionId: LIBRARY_SEED_ARCHIVED_SESSION_ID,
		projectId: LIBRARY_SEED_PROJECT_ID,
		title: "Archived thread",
	}),
	SessionArchiveCommand.make({
		type: "session.archive",
		commandId: CommandId.make("seed-library-archive"),
		sessionId: LIBRARY_SEED_ARCHIVED_SESSION_ID,
	}),
	SessionCreateCommand.make({
		type: "session.create",
		commandId: CommandId.make("seed-library-session-deleted"),
		sessionId: LIBRARY_SEED_DELETED_SESSION_ID,
		projectId: LIBRARY_SEED_PROJECT_ID,
		title: "Deleted thread",
	}),
	SessionDeleteCommand.make({
		type: "session.delete",
		commandId: CommandId.make("seed-library-delete"),
		sessionId: LIBRARY_SEED_DELETED_SESSION_ID,
	}),
]

export const seedLibrary = Effect.fn("seedLibrary")(function*() {
	const engine = yield* OrchestrationEngine
	yield* Effect.forEach(LIBRARY_SEED_COMMANDS, (command) => engine.dispatch(command), {
		discard: true
	})
	return Arr.length(LIBRARY_SEED_COMMANDS)
})
