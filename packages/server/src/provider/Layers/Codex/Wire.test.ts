import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { defaultCodexNativeConfigState } from "./Provider.ts"
import {
	buildCodexInitializeParams,
	buildCodexTurnStartParams,
	buildThreadResumeParams,
	buildThreadStartParams,
	buildTurnInterruptParams,
	parseThreadId,
	parseTurnId
} from "./Wire.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const isJsonObject = Schema.is(Schema.JsonObject)

const asObject = (value: Json | undefined): Option.Option<JsonObject> => {
	if (value === undefined || isJsonObject(value) === false) {
		return Option.none()
	}
	return Option.some(value)
}

Vitest.describe("CodexWire", () => {
	Vitest.it("builds native protocol payloads", () => {
		Vitest.assert.deepStrictEqual(buildThreadStartParams("/tmp/project"), {
			cwd: "/tmp/project",
			experimentalRawEvents: false,
			persistExtendedHistory: true
		})
		Vitest.assert.deepStrictEqual(buildThreadResumeParams("thread-1", "/tmp/project"), {
			threadId: "thread-1",
			cwd: "/tmp/project",
			persistExtendedHistory: true
		})
		Vitest.assert.deepStrictEqual(buildTurnInterruptParams("thread-1", "turn-1"), {
			threadId: "thread-1",
			turnId: "turn-1"
		})
		const initialize = buildCodexInitializeParams()
		const capabilities = asObject(initialize.capabilities)
		Vitest.assert.isTrue(Option.isSome(capabilities))
		if (Option.isSome(capabilities)) {
			Vitest.assert.strictEqual(capabilities.value.experimentalApi, true)
		}
		const turn = buildCodexTurnStartParams({
			threadId: "thread-1",
			text: "Hello",
			state: defaultCodexNativeConfigState(),
			modeId: "plan"
		})
		Vitest.assert.strictEqual(turn.threadId, "thread-1")
		Vitest.assert.strictEqual(turn.effort, "high")
		const collaboration = asObject(turn.collaborationMode)
		Vitest.assert.isTrue(Option.isSome(collaboration))
		if (Option.isSome(collaboration)) {
			Vitest.assert.strictEqual(collaboration.value.mode, "plan")
		}
	})

	Vitest.it("parses thread and turn ids from app-server results", () => {
		Vitest.assert.deepStrictEqual(
			parseThreadId({ thread: { id: "thread-1" } }),
			Option.some("thread-1")
		)
		Vitest.assert.deepStrictEqual(parseThreadId({ threadId: "thread-2" }), Option.some("thread-2"))
		Vitest.assert.deepStrictEqual(parseTurnId({ turn: { id: "turn-1" } }), Option.some("turn-1"))
	})
})
