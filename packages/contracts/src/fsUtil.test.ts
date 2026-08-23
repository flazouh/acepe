import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { GetDefaultShellRequest, ReadTextFileRequest, WriteTextFileRequest } from "./fsUtil.ts"
import { SessionId } from "./ids.ts"

describe("ReadTextFileRequest", () => {
	it("decodes a path with no pagination", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(ReadTextFileRequest)({
			path: "/tmp/acepe/file.ts",
		}))
		expect(decoded.path).toBe("/tmp/acepe/file.ts")
		expect(decoded.line).toBeUndefined()
		expect(decoded.limit).toBeUndefined()
	})

	it("decodes a path with line and limit pagination", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(ReadTextFileRequest)({
			path: "/tmp/acepe/file.ts",
			line: 3,
			limit: 10,
		}))
		expect(decoded.line).toBe(3)
		expect(decoded.limit).toBe(10)
	})

	it("rejects a blank path", () => {
		const decoded = Effect.runSyncExit(Schema.decodeUnknownEffect(ReadTextFileRequest)({
			path: "   ",
		}))
		expect(decoded._tag).toBe("Failure")
	})

	it("rejects a zero or negative line number", () => {
		const decoded = Effect.runSyncExit(Schema.decodeUnknownEffect(ReadTextFileRequest)({
			path: "/tmp/acepe/file.ts",
			line: 0,
		}))
		expect(decoded._tag).toBe("Failure")
	})
})

describe("WriteTextFileRequest", () => {
	it("decodes path, content, and sessionId", () => {
		const sessionId = SessionId.make("session-1")
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(WriteTextFileRequest)({
			path: "/tmp/acepe/file.ts",
			content: "hello",
			sessionId,
		}))
		expect(decoded.path).toBe("/tmp/acepe/file.ts")
		expect(decoded.content).toBe("hello")
		expect(decoded.sessionId).toBe(sessionId)
	})

	it("allows empty content", () => {
		const sessionId = SessionId.make("session-1")
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(WriteTextFileRequest)({
			path: "/tmp/acepe/file.ts",
			content: "",
			sessionId,
		}))
		expect(decoded.content).toBe("")
	})
})

describe("GetDefaultShellRequest", () => {
	it("decodes an empty payload", () => {
		const decoded = Effect.runSync(Schema.decodeUnknownEffect(GetDefaultShellRequest)({}))
		expect(decoded).toEqual({})
	})
})
