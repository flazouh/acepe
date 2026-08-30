import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import { selectPermissionOptionId } from "./Permissions.ts"

Vitest.describe("selectPermissionOptionId", () => {
	Vitest.it("selects allow_once for allow and reject_once for deny", () => {
		const request = {
			sessionId: "sess-1",
			toolCall: {
				toolCallId: "call_9",
				title: "Run tests",
				kind: "execute",
				status: "pending"
			},
			options: [
				{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				{ optionId: "reject", name: "Reject", kind: "reject_once" }
			]
		}
		Vitest.assert.deepStrictEqual(selectPermissionOptionId(request, "allow"), Option.some("allow-once"))
		Vitest.assert.deepStrictEqual(selectPermissionOptionId(request, "deny"), Option.some("reject"))
	})
})
