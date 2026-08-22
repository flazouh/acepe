import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"

import { CheckpointId, CommandId, MessageId, ProjectId, SessionId, ToolCallId, TurnId } from "./ids.ts"
import {
	commandToAggregateRef,
	CheckpointCreateCommand,
	CheckpointReportReadinessCommand,
	CheckpointRevertCommand,
	MessageSendCommand,
	TokenAppendCommand,
	type OrchestrationAggregateRef,
	OrchestrationCommand,
	ProjectCreateCommand,
	ProjectDeleteCommand,
	ProjectMetaUpdateCommand,
	SessionArchiveCommand,
	SessionCreateCommand,
	SessionDeleteCommand,
	SessionMetaUpdateCommand,
	SessionUnarchiveCommand,
	SettingsSetCommand,
	SkillsDiscoverCommand,
	TurnCancelCommand,
} from "./orchestration.ts"
import { APP_SETTINGS_ID } from "./settings.ts"
import { APP_SKILLS_ID, emptySkillsCatalog } from "./skills.ts"

const v1CommandTypes = [
	"project.create",
	"project.meta.update",
	"project.delete",
	"session.create",
	"session.meta.update",
	"session.archive",
	"session.unarchive",
	"session.delete",
	"message.send",
	"token.append",
	"turn.cancel",
	"checkpoint.create",
	"checkpoint.report-readiness",
	"checkpoint.revert",
	"settings.set",
	"skills.discover",
] as const

type V1CommandType = (typeof v1CommandTypes)[number]
type CommandType = OrchestrationCommand["type"]
const _v1CommandTypesMatchUnion: [CommandType] extends [V1CommandType]
	? [V1CommandType] extends [CommandType]
		? true
		: never
	: never = true

const decodeCommand = Schema.decodeUnknownEffect(OrchestrationCommand)
const encodeCommand = Schema.encodeEffect(OrchestrationCommand)

const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const messageId = MessageId.make("message-1")
const turnId = TurnId.make("turn-1")
const checkpointId = CheckpointId.make("checkpoint-1")
const toolCallId = ToolCallId.make("tool-1")

const memberCases = [
	{
		schema: ProjectCreateCommand,
		aggregate: {
			aggregateKind: "project",
			aggregateId: projectId,
		} satisfies OrchestrationAggregateRef,
		command: ProjectCreateCommand.make({
			type: "project.create",
			commandId,
			projectId,
			title: "Acepe",
			workspaceRoot: "/tmp/acepe",
		}),
	},
	{
		schema: ProjectMetaUpdateCommand,
		aggregate: {
			aggregateKind: "project",
			aggregateId: projectId,
		} satisfies OrchestrationAggregateRef,
		command: ProjectMetaUpdateCommand.make({
			type: "project.meta.update",
			commandId,
			projectId,
			title: "Acepe Desktop",
		}),
	},
	{
		schema: ProjectDeleteCommand,
		aggregate: {
			aggregateKind: "project",
			aggregateId: projectId,
		} satisfies OrchestrationAggregateRef,
		command: ProjectDeleteCommand.make({
			type: "project.delete",
			commandId,
			projectId,
		}),
	},
	{
		schema: SessionCreateCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: SessionCreateCommand.make({
			type: "session.create",
			commandId,
			sessionId,
			projectId,
			title: "First session",
		}),
	},
	{
		schema: SessionMetaUpdateCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: SessionMetaUpdateCommand.make({
			type: "session.meta.update",
			commandId,
			sessionId,
			title: "Renamed session",
		}),
	},
	{
		schema: SessionArchiveCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: SessionArchiveCommand.make({
			type: "session.archive",
			commandId,
			sessionId,
		}),
	},
	{
		schema: SessionUnarchiveCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: SessionUnarchiveCommand.make({
			type: "session.unarchive",
			commandId,
			sessionId,
		}),
	},
	{
		schema: SessionDeleteCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: SessionDeleteCommand.make({
			type: "session.delete",
			commandId,
			sessionId,
		}),
	},
	{
		schema: MessageSendCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: MessageSendCommand.make({
			type: "message.send",
			commandId,
			sessionId,
			messageId,
			text: "Ship the lifecycle slice",
		}),
	},
	{
		schema: TokenAppendCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: TokenAppendCommand.make({
			type: "token.append",
			commandId,
			sessionId,
			messageId,
			token: "Hello",
		}),
	},
	{
		schema: TurnCancelCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: TurnCancelCommand.make({
			type: "turn.cancel",
			commandId,
			sessionId,
			turnId,
		}),
	},
	{
		schema: CheckpointCreateCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: CheckpointCreateCommand.make({
			type: "checkpoint.create",
			commandId,
			sessionId,
			checkpointId,
			checkpointNumber: 1,
			name: "After edit",
			isAuto: true,
			toolCallId,
			fileCount: 2,
		}),
	},
	{
		schema: CheckpointReportReadinessCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: CheckpointReportReadinessCommand.make({
			type: "checkpoint.report-readiness",
			commandId,
			sessionId,
			checkpointId,
			status: "ready",
		}),
	},
	{
		schema: CheckpointRevertCommand,
		aggregate: {
			aggregateKind: "session",
			aggregateId: sessionId,
		} satisfies OrchestrationAggregateRef,
		command: CheckpointRevertCommand.make({
			type: "checkpoint.revert",
			commandId,
			sessionId,
			checkpointId,
		}),
	},
	{
		schema: SettingsSetCommand,
		aggregate: {
			aggregateKind: "settings",
			aggregateId: APP_SETTINGS_ID,
		} satisfies OrchestrationAggregateRef,
		command: SettingsSetCommand.make({
			type: "settings.set",
			commandId,
			key: "ui_font_size",
			value: "14",
		}),
	},
	{
		schema: SkillsDiscoverCommand,
		aggregate: {
			aggregateKind: "skills",
			aggregateId: APP_SKILLS_ID,
		} satisfies OrchestrationAggregateRef,
		command: SkillsDiscoverCommand.make({
			type: "skills.discover",
			commandId,
			catalog: emptySkillsCatalog,
		}),
	},
] as const

const roundTrip = (command: OrchestrationCommand): void => {
	const encoded = Effect.runSync(encodeCommand(command))
	const decoded = Effect.runSync(decodeCommand(encoded))
	const reencoded = Effect.runSync(encodeCommand(decoded))
	expect(reencoded).toEqual(encoded)
}

describe("OrchestrationCommand", () => {
	it("covers the v1 command types exactly once", () => {
		expect(_v1CommandTypesMatchUnion).toBe(true)
		expect(memberCases.map((member) => member.command.type)).toEqual([...v1CommandTypes])
	})

	it("decodes every v1 member with a commandId", () => {
		for (const { command } of memberCases) {
			const decoded = Effect.runSync(decodeCommand(command))
			expect(decoded.commandId).toBe(commandId)
			expect(decoded.type).toBe(command.type)
		}
	})

	it("rejects a payload with an unknown type tag", () => {
		const exit = Effect.runSyncExit(
			decodeCommand({
				type: "provider.sync",
				commandId: "cmd-1",
				sessionId: "session-1",
			}),
		)
		expect(Exit.isFailure(exit)).toBe(true)
	})

	it("rejects a payload with no commandId", () => {
		const exit = Effect.runSyncExit(
			decodeCommand({
				type: "project.delete",
				projectId: "project-1",
			}),
		)
		expect(Exit.isFailure(exit)).toBe(true)
	})

	it("round-trips every fixture through encode then decode", () => {
		for (const { command } of memberCases) {
			roundTrip(command)
		}
	})

	it("round-trips turn.cancel when turnId is absent", () => {
		roundTrip(
			TurnCancelCommand.make({
				type: "turn.cancel",
				commandId,
				sessionId,
			}),
		)
	})

	it("round-trips session.meta.update with a pull-request link", () => {
		roundTrip(
			SessionMetaUpdateCommand.make({
				type: "session.meta.update",
				commandId,
				sessionId,
				prNumber: 42,
				prLinkMode: "manual",
			}),
		)
	})

	for (const { command, schema } of memberCases) {
		it(`round-trips generated ${command.type} commands`, () => {
			const arbitrary = Schema.toArbitrary(schema)(FastCheck)
			FastCheck.assert(
				FastCheck.property(arbitrary, (generated) => {
					const encoded = Effect.runSync(Schema.encodeEffect(schema)(generated))
					const decoded = Effect.runSync(Schema.decodeUnknownEffect(schema)(encoded))
					const reencoded = Effect.runSync(Schema.encodeEffect(schema)(decoded))
					expect(reencoded).toEqual(encoded)
				}),
				{ numRuns: 50, seed: 1 },
			)
		})
	}

	it("round-trips generated union members", () => {
		const arbitrary = Schema.toArbitrary(OrchestrationCommand)(FastCheck)
		FastCheck.assert(
			FastCheck.property(arbitrary, (command) => {
				roundTrip(command)
			}),
			{ numRuns: 100, seed: 1 },
		)
	})
})

describe("commandToAggregateRef", () => {
	it("maps every v1 command to its aggregate", () => {
		for (const { aggregate, command } of memberCases) {
			expect(commandToAggregateRef(command)).toEqual(aggregate)
		}
	})

	it("maps turn.cancel without turnId to the session", () => {
		expect(
			commandToAggregateRef(
				TurnCancelCommand.make({
					type: "turn.cancel",
					commandId,
					sessionId,
				}),
			),
		).toEqual({
			aggregateKind: "session",
			aggregateId: sessionId,
		})
	})
})
