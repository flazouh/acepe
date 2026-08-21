import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
	asNonEmptyText,
	extractJsonText,
	projectTitleFromWorkspace,
	sessionTitleFromUserText,
	untitledConversationTitle
} from "./text.ts"

const text = (value: string) => Schema.decodeUnknownSync(TrimmedNonEmptyString)(value)

Vitest.describe("extractJsonText", () => {
	Vitest.it("reads a string", () => {
		Vitest.assert.strictEqual(extractJsonText("Hello"), "Hello")
	})

	Vitest.it("joins text blocks and skips tool blocks", () => {
		Vitest.assert.strictEqual(
			extractJsonText([
				{ type: "text", text: "Hello" },
				{ type: "tool_use", text: "ignored" },
				{ type: "text", text: "world" }
			]),
			"Hello\nworld"
		)
	})

	Vitest.it("reads a single text object", () => {
		Vitest.assert.strictEqual(extractJsonText({ type: "text", text: "Hi" }), "Hi")
	})
})

Vitest.describe("asNonEmptyText", () => {
	Vitest.it("returns none for blank text", () => {
		Vitest.assert.isTrue(Option.isNone(asNonEmptyText("   ")))
	})

	Vitest.it("returns trimmed non-empty text", () => {
		const text = asNonEmptyText("  Hello  ")
		Vitest.assert.isTrue(Option.isSome(text))
		if (Option.isSome(text)) {
			Vitest.assert.strictEqual(text.value, "Hello")
		}
	})
})

Vitest.describe("sessionTitleFromUserText", () => {
	Vitest.it("uses the first user line", () => {
		Vitest.assert.strictEqual(
			sessionTitleFromUserText(Option.some(text("Hello from Claude"))),
			"Hello from Claude"
		)
	})

	Vitest.it("falls back to untitled conversation", () => {
		Vitest.assert.strictEqual(sessionTitleFromUserText(Option.none()), untitledConversationTitle())
	})

	Vitest.it("skips slash commands", () => {
		Vitest.assert.strictEqual(
			sessionTitleFromUserText(Option.some(text("/clear"))),
			untitledConversationTitle()
		)
	})
})

Vitest.describe("projectTitleFromWorkspace", () => {
	Vitest.it("uses the workspace basename when it is a title", () => {
		Vitest.assert.strictEqual(projectTitleFromWorkspace("acepe"), "acepe")
	})

	Vitest.it("falls back when the basename is blank", () => {
		Vitest.assert.strictEqual(projectTitleFromWorkspace("   "), "Imported project")
	})
})
