import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	formatDoctorOk,
	QaDoctorReport,
	QaSocketRequest,
	QaSocketRequestLine,
	QaSocketResponseLine,
} from "./protocol.ts"

describe("protocol", () => {
	it.effect("formats doctor output with title url and window count", () =>
		Effect.gen(function* () {
			const report = yield* Schema.decodeUnknownEffect(QaDoctorReport)({
				title: "Acepe",
				url: "views://mainview/index.html",
				windows: 1,
			})
			expect(formatDoctorOk(report)).toBe(
				"doctor: ok\n- title: Acepe\n- url: views://mainview/index.html\n- windows: 1",
			)
		}),
	)

	it.effect("decodes a newline-delimited socket request", () =>
		Effect.gen(function* () {
			const request = yield* Schema.decodeUnknownEffect(QaSocketRequestLine)(
				'{"id":"1","method":"doctor"}',
			)
			expect(request.id).toBe("1")
			expect(request.method).toBe("doctor")
		}),
	)

	it.effect("decodes a socket success line", () =>
		Effect.gen(function* () {
			const response = yield* Schema.decodeUnknownEffect(QaSocketResponseLine)(
				'{"id":"1","ok":true,"value":{"title":"Acepe"}}',
			)
			expect(response.ok).toBe(true)
			expect(response.id).toBe("1")
		}),
	)

	it.effect("rejects a request without id", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Schema.decodeUnknownEffect(QaSocketRequest)({
					method: "doctor",
				}),
			)
			expect(exit._tag).toBe("Failure")
		}),
	)
})
