import {
	type EventId,
	type GitBlameLoadCommand,
	type GitBlameLoadedEvent,
	type GitDiffLoadCommand,
	type GitDiffLoadedEvent,
	type GitHunkAcceptCommand,
	type GitHunkAcceptedEvent,
	type GitHunkRejectCommand,
	type GitHunkRejectedEvent,
	type GitStatusRefreshCommand,
	type GitStatusRefreshedEvent,
	type IsoDateTime,
	type JsonObject,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type Sequence
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { requireProject, type OrchestrationReadModel } from "./commandInvariants.ts"
import type { OrchestrationCommandInvariantError } from "./Errors.ts"

type GitDecideIdentity = {
	readonly eventId: EventId
	readonly occurredAt: IsoDateTime
}

export type GitCommand = Extract<
	OrchestrationCommand,
	{
		readonly type:
			| "git.status.refresh"
			| "git.diff.load"
			| "git.blame.load"
			| "git.hunk.accept"
			| "git.hunk.reject"
	}
>

const EMPTY_METADATA: JsonObject = {}

const nextSequence = (snapshotSequence: Sequence): Sequence => snapshotSequence + 1

const gitEvent = <Type extends string, Payload>(
	command: { readonly commandId: OrchestrationEvent["commandId"]; readonly projectId: GitCommand["projectId"] },
	identity: GitDecideIdentity,
	sequence: Sequence,
	type: Type,
	payload: Payload
) => ({
	sequence,
	eventId: identity.eventId,
	aggregateKind: "git" as const,
	aggregateId: command.projectId,
	occurredAt: identity.occurredAt,
	commandId: command.commandId,
	causationEventId: null,
	correlationId: command.commandId,
	metadata: EMPTY_METADATA,
	type,
	payload
})

const gitStatusRefreshedEvent = (
	command: GitStatusRefreshCommand,
	identity: GitDecideIdentity,
	sequence: Sequence
): GitStatusRefreshedEvent =>
	gitEvent(command, identity, sequence, "GitStatusRefreshed", {
		projectId: command.projectId,
		status: command.status
	})

const gitDiffLoadedEvent = (
	command: GitDiffLoadCommand,
	identity: GitDecideIdentity,
	sequence: Sequence
): GitDiffLoadedEvent =>
	gitEvent(command, identity, sequence, "GitDiffLoaded", {
		projectId: command.projectId,
		filePath: command.filePath,
		diff: command.diff,
		patch: command.patch
	})

const gitBlameLoadedEvent = (
	command: GitBlameLoadCommand,
	identity: GitDecideIdentity,
	sequence: Sequence
): GitBlameLoadedEvent =>
	gitEvent(command, identity, sequence, "GitBlameLoaded", {
		projectId: command.projectId,
		filePath: command.filePath,
		blame: command.blame
	})

const gitHunkAcceptedEvent = (
	command: GitHunkAcceptCommand,
	identity: GitDecideIdentity,
	sequence: Sequence
): GitHunkAcceptedEvent =>
	gitEvent(command, identity, sequence, "GitHunkAccepted", {
		projectId: command.projectId,
		filePath: command.filePath,
		hunkIndex: command.hunkIndex
	})

const gitHunkRejectedEvent = (
	command: GitHunkRejectCommand,
	identity: GitDecideIdentity,
	sequence: Sequence
): GitHunkRejectedEvent =>
	gitEvent(command, identity, sequence, "GitHunkRejected", {
		projectId: command.projectId,
		filePath: command.filePath,
		hunkIndex: command.hunkIndex,
		newContent: command.newContent
	})

export const decideGit = Effect.fn("decideGit")(function*(
	readModel: OrchestrationReadModel,
	command: GitCommand,
	identity: GitDecideIdentity
): Effect.fn.Return<ReadonlyArray<OrchestrationEvent>, OrchestrationCommandInvariantError> {
	yield* requireProject({
		readModel,
		projectId: command.projectId,
		command
	})
	const sequence = nextSequence(readModel.snapshotSequence)
	switch (command.type) {
		case "git.status.refresh":
			return [gitStatusRefreshedEvent(command, identity, sequence)]
		case "git.diff.load":
			return [gitDiffLoadedEvent(command, identity, sequence)]
		case "git.blame.load":
			return [gitBlameLoadedEvent(command, identity, sequence)]
		case "git.hunk.accept":
			return [gitHunkAcceptedEvent(command, identity, sequence)]
		case "git.hunk.reject":
			return [gitHunkRejectedEvent(command, identity, sequence)]
	}
})
