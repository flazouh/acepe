import {
	APP_SETTINGS_ID,
	CommandId,
	EventId,
	type OrchestrationEvent,
	ProjectId,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { evolveProjectedSetting, settingKeyFromEvent } from "./ProjectionSettings.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")

const settingsUpdated = (
	sequence: number,
	key: "ui_font_size" | "code_font_size" | "user_theme",
	value: string
): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "settings",
	aggregateId: APP_SETTINGS_ID,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SettingsUpdated",
	payload: {
		key,
		value
	}
})

const projectCreated: OrchestrationEvent = {
	sequence: 1,
	eventId: EventId.make("event-1"),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
}

const sessionCreated: OrchestrationEvent = {
	sequence: 2,
	eventId: EventId.make("event-2"),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "SessionCreated",
	payload: {
		sessionId,
		projectId,
		title: "First session"
	}
}

Vitest.describe("evolveProjectedSetting", () => {
	Vitest.it.effect("projects SettingsUpdated as a setting row", () =>
		Effect.gen(function*() {
			const next = yield* evolveProjectedSetting(Option.none(), settingsUpdated(1, "ui_font_size", "14"))
			Vitest.assert.deepStrictEqual(next, Option.some({
				key: "ui_font_size",
				value: "14",
				sequence: 1
			}))
		})
	)

	Vitest.it.effect("overwrites the value on a later SettingsUpdated for the same key", () =>
		Effect.gen(function*() {
			const first = yield* evolveProjectedSetting(
				Option.none(),
				settingsUpdated(1, "ui_font_size", "14")
			)
			const next = yield* evolveProjectedSetting(first, settingsUpdated(2, "ui_font_size", "16"))
			Vitest.assert.deepStrictEqual(next, Option.some({
				key: "ui_font_size",
				value: "16",
				sequence: 2
			}))
		})
	)

	Vitest.it.effect("ignores project and session events", () =>
		Effect.gen(function*() {
			const current = Option.some({
				key: "ui_font_size" as const,
				value: "14",
				sequence: 1
			})
			const afterProject = yield* evolveProjectedSetting(current, projectCreated)
			const afterSession = yield* evolveProjectedSetting(afterProject, sessionCreated)
			Vitest.assert.deepStrictEqual(afterSession, current)
		})
	)
})

Vitest.describe("settingKeyFromEvent", () => {
	Vitest.it("reads the key from SettingsUpdated and ignores other events", () => {
		Vitest.assert.deepStrictEqual(
			settingKeyFromEvent(settingsUpdated(1, "code_font_size", "13")),
			Option.some("code_font_size")
		)
		Vitest.assert.deepStrictEqual(settingKeyFromEvent(projectCreated), Option.none())
		Vitest.assert.deepStrictEqual(settingKeyFromEvent(sessionCreated), Option.none())
	})
})
