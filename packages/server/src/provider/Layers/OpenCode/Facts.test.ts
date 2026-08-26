import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import { withCompactCommand } from "./Facts.ts"

Vitest.describe("OpenCode native protocol helpers", () => {
	Vitest.it("adds compact when the command list omits it", () => {
		const commands = withCompactCommand([{ name: "init", description: "init" }])
		Vitest.assert.strictEqual(
			Arr.some(commands, (command) => command.name === "compact"),
			true
		)
	})
})
