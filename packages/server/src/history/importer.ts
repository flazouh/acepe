import {
	decodeCommandId,
	decodeMessageId,
	decodeSessionId,
	MessageSendCommand,
	type OrchestrationEvent,
	ProjectCreateCommand,
	ProjectId,
	type Sequence,
	SessionCreateCommand,
	SessionId,
	TokenAppendCommand,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Path from "effect/Path"
import type { PlatformError } from "effect/PlatformError"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Str from "effect/String"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import type { OrchestrationDispatchError } from "../orchestration/Services/OrchestrationEngine.ts"
import { OrchestrationEngine } from "../orchestration/Services/OrchestrationEngine.ts"
import {
	ProjectionSnapshotQuery,
	SessionProjectionSnapshot
} from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts"
import {
	PROJECTION_SESSION_MESSAGES_NAME,
	ProjectionSessionMessages
} from "../persistence/Services/ProjectionSessionMessages.ts"
import { ProjectionSessions } from "../persistence/Services/ProjectionSessions.ts"
import { ProjectionState } from "../persistence/Services/ProjectionState.ts"
import type { HistoryDirectoryNotFoundError } from "./Errors.ts"
import { HistoryMalformedLineWarning } from "./Errors.ts"
import { listJsonlFiles } from "./files.ts"
import { decodeJsonl } from "./jsonl.ts"
import { type HistoryTextFact, projectTitleFromWorkspace, sessionTitleFromUserText } from "./text.ts"

const EVENT_PAGE_SIZE = 1_000

const decodeProjectorName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)
const isInvariantError = Schema.is(OrchestrationCommandInvariantError)
const sessionIdOrder = Order.mapInput(Str.Order, (sessionId: SessionId): string => sessionId)

export const HistoryImportInput = Schema.Struct({
	root: TrimmedNonEmptyString,
	projectId: ProjectId,
	workspaceRoot: TrimmedNonEmptyString
})
export type HistoryImportInput = typeof HistoryImportInput.Type

export const HistoryImportResult = Schema.Struct({
	snapshots: Schema.Array(SessionProjectionSnapshot),
	warnings: Schema.Array(HistoryMalformedLineWarning)
})
export type HistoryImportResult = typeof HistoryImportResult.Type

const decodeImportResult = Schema.decodeUnknownEffect(HistoryImportResult)

export type HistoryImportError =
	| HistoryDirectoryNotFoundError
	| OrchestrationDispatchError
	| PlatformError
	| Schema.SchemaError
	| SqlError

export type HistoryImporterShape = {
	readonly importDirectory: (
		input: HistoryImportInput
	) => Effect.Effect<HistoryImportResult, HistoryImportError>
}

export type HistoryProviderKind = "claude" | "cursor" | "opencode"

export type HistoryLineDecoder<A> = {
	readonly provider: HistoryProviderKind
	readonly lineSchema: Schema.Codec<A>
	readonly factFromLine: (line: A) => Option.Option<HistoryTextFact>
	readonly sessionIdFromLine: (line: A) => Option.Option<string>
}

type EventStoreShape = {
	readonly readFrom: (
		sequence: Sequence,
		limit: number
	) => Stream.Stream<OrchestrationEvent, SqlError | Schema.SchemaError>
}

const readAllFrom = Effect.fn("HistoryImporter.readAllFrom")(function*(
	store: EventStoreShape,
	fromSequence: Sequence
) {
	let cursor = fromSequence
	let acc: ReadonlyArray<OrchestrationEvent> = Arr.empty()
	while (true) {
		const page = yield* Stream.runCollect(store.readFrom(cursor, EVENT_PAGE_SIZE))
		if (Arr.isReadonlyArrayNonEmpty(page) === false) {
			return acc
		}
		acc = Arr.appendAll(acc, page)
		cursor = Arr.lastNonEmpty(page).sequence
		if (page.length < EVENT_PAGE_SIZE) {
			return acc
		}
	}
})

const firstUserText = (
	facts: ReadonlyArray<HistoryTextFact>
): Option.Option<TrimmedNonEmptyString> =>
	Option.map(
		Arr.findFirst(facts, (fact) => fact.role === "user"),
		(fact) => fact.text
	)

export const noSessionIdFromLine = <A>(_line: A): Option.Option<string> => Option.none()

const importCommandId = Effect.fn("HistoryImporter.commandId")(function*(
	parts: ReadonlyArray<string>
) {
	return yield* decodeCommandId(parts.join(":"))
})

export const makeHistoryImporter = <A>(config: HistoryLineDecoder<A>) =>
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const sql = yield* SqlClient.SqlClient
		const engine = yield* OrchestrationEngine
		const store = yield* OrchestrationEventStore
		const sessions = yield* ProjectionSessions
		const messages = yield* ProjectionSessionMessages
		const projectionState = yield* ProjectionState
		const snapshots = yield* ProjectionSnapshotQuery
		const messagesName = yield* decodeProjectorName(PROJECTION_SESSION_MESSAGES_NAME)

		const ensureProject = Effect.fn("HistoryImporter.ensureProject")(function*(
			input: HistoryImportInput
		) {
			const commandId = yield* importCommandId([
				"history",
				config.provider,
				"project",
				input.projectId
			])
			const title = projectTitleFromWorkspace(path.basename(input.workspaceRoot))
			const outcome = yield* Effect.result(
				engine.dispatch(
					ProjectCreateCommand.make({
						type: "project.create",
						commandId,
						projectId: input.projectId,
						title,
						workspaceRoot: input.workspaceRoot
					})
				)
			)
			if (Result.isFailure(outcome) && isInvariantError(outcome.failure) === false) {
				return yield* outcome.failure
			}
		})

		const applyImportedEvents = Effect.fn("HistoryImporter.applyImportedEvents")(function*(
			fromSequence: Sequence,
			toSequence: Sequence
		) {
			if (toSequence <= fromSequence) {
				return
			}
			const events = yield* readAllFrom(store, fromSequence)
			yield* sql.withTransaction(
				Effect.gen(function*() {
					yield* Effect.forEach(events, (event) => sessions.apply(event, sql), {
						discard: true
					})
					yield* Effect.forEach(events, (event) => messages.apply(event, sql), {
						discard: true
					})
					yield* projectionState.checkpoint(sessions.name, toSequence)
					yield* projectionState.checkpoint(messagesName, toSequence)
				})
			)
		})

		const importFile = Effect.fn("HistoryImporter.importFile")(function*(
			input: HistoryImportInput,
			filePath: string
		) {
			const content = yield* fs.readFileString(filePath)
			const decoded = yield* decodeJsonl(config.lineSchema, content, filePath)
			const facts = Arr.filterMap(
				decoded.rows,
				Filter.fromPredicateOption(config.factFromLine)
			)
			if (facts.length === 0) {
				return {
					sessionId: Option.none<SessionId>(),
					warnings: decoded.warnings
				}
			}
			const fromLine = Option.flatMap(Arr.head(decoded.rows), config.sessionIdFromLine)
			const stem = path.basename(filePath, ".jsonl")
			const sessionId = yield* decodeSessionId(Option.getOrElse(fromLine, () => stem))
			const title = sessionTitleFromUserText(firstUserText(facts))
			const sessionCommandId = yield* importCommandId([
				"history",
				config.provider,
				"session",
				sessionId
			])
			yield* engine.dispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: sessionCommandId,
					sessionId,
					projectId: input.projectId,
					title
				})
			)
			let userIndex = 0
			let assistantIndex = 0
			for (const fact of facts) {
				if (fact.role === "user") {
					const index = userIndex
					userIndex = userIndex + 1
					const messageId = yield* decodeMessageId(`${sessionId}:user:${String(index)}`)
					const commandId = yield* importCommandId([
						"history",
						config.provider,
						"user",
						sessionId,
						String(index)
					])
					yield* engine.dispatch(
						MessageSendCommand.make({
							type: "message.send",
							commandId,
							sessionId,
							messageId,
							text: fact.text
						})
					)
					continue
				}
				const index = assistantIndex
				assistantIndex = assistantIndex + 1
				const messageId = yield* decodeMessageId(`${sessionId}:assistant:${String(index)}`)
				const commandId = yield* importCommandId([
					"history",
					config.provider,
					"assistant",
					sessionId,
					String(index)
				])
				yield* engine.dispatch(
					TokenAppendCommand.make({
						type: "token.append",
						commandId,
						sessionId,
						messageId,
						token: fact.text
					})
				)
			}
			return {
				sessionId: Option.some(sessionId),
				warnings: decoded.warnings
			}
		})

		const importDirectory = Effect.fn("HistoryImporter.importDirectory")(function*(
			input: HistoryImportInput
		) {
			const files = yield* listJsonlFiles(fs, path, input.root)
			const before = yield* engine.latestSequence
			yield* ensureProject(input)
			let warnings: ReadonlyArray<HistoryMalformedLineWarning> = Arr.empty()
			let sessionIds: ReadonlyArray<SessionId> = Arr.empty()
			for (const filePath of files) {
				const imported = yield* importFile(input, filePath)
				warnings = Arr.appendAll(warnings, imported.warnings)
				if (Option.isSome(imported.sessionId)) {
					sessionIds = Arr.append(sessionIds, imported.sessionId.value)
				}
			}
			const after = yield* engine.latestSequence
			yield* applyImportedEvents(before, after)
			const orderedIds = Arr.sort(sessionIds, sessionIdOrder)
			const sessionSnapshots = yield* Effect.forEach(orderedIds, (sessionId) =>
				snapshots.snapshot(sessionId)
			)
			return yield* decodeImportResult({
				snapshots: sessionSnapshots,
				warnings
			})
		})

		return {
			importDirectory
		} satisfies HistoryImporterShape
	})
