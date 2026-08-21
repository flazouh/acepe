import * as Vitest from "@effect/vitest"
import * as Option from "effect/Option"
import {
	collectNodeBinaryCandidates,
	DEFAULT_NODE_BINARY,
	DEFAULT_NODE_BINARY_CANDIDATES,
	isBunNodeShimPath,
	nodeBinaryFromHome,
	nodeBinaryFromPathVariable,
	pickNodeBinary
} from "./nodeBinary.ts"

Vitest.describe("isBunNodeShimPath", () => {
	Vitest.it("detects Bun's node shim paths", () => {
		Vitest.assert.strictEqual(isBunNodeShimPath("/Users/alex/.bun/bin/node"), true)
		Vitest.assert.strictEqual(isBunNodeShimPath("/private/tmp/bun-node-34cbb9a40"), true)
		Vitest.assert.strictEqual(isBunNodeShimPath("/opt/homebrew/bin/node"), false)
		Vitest.assert.strictEqual(isBunNodeShimPath("/Users/alex/.hermes/node/bin/node"), false)
	})
})

Vitest.describe("nodeBinaryFromPathVariable", () => {
	Vitest.it("skips Bun shims and keeps real Node paths", () => {
		Vitest.assert.deepStrictEqual(
			nodeBinaryFromPathVariable("/Users/alex/.hermes/node/bin:/Users/alex/.bun/bin:/opt/homebrew/bin"),
			["/Users/alex/.hermes/node/bin/node", "/opt/homebrew/bin/node"]
		)
	})
})

Vitest.describe("collectNodeBinaryCandidates", () => {
	Vitest.it("puts Hermes, PATH, then known defaults, without duplicates", () => {
		const candidates = collectNodeBinaryCandidates(
			Option.some("/Users/alex"),
			Option.some("/opt/homebrew/bin:/usr/bin")
		)
		Vitest.assert.strictEqual(candidates[0], nodeBinaryFromHome("/Users/alex"))
		Vitest.assert.strictEqual(candidates[1], "/opt/homebrew/bin/node")
		Vitest.assert.strictEqual(candidates[2], "/usr/bin/node")
		Vitest.assert.strictEqual(candidates.includes("/usr/local/bin/node"), true)
		Vitest.assert.deepStrictEqual(DEFAULT_NODE_BINARY_CANDIDATES[0], "/opt/homebrew/bin/node")
	})
})

Vitest.describe("pickNodeBinary", () => {
	Vitest.it("prefers ACEPE_NODE_BINARY, then the first existing candidate, then node", () => {
		Vitest.assert.strictEqual(
			pickNodeBinary(Option.some("/custom/node"), ["/opt/homebrew/bin/node"]),
			"/custom/node"
		)
		Vitest.assert.strictEqual(
			pickNodeBinary(Option.some("/private/tmp/bun-node-1"), ["/opt/homebrew/bin/node"]),
			"/opt/homebrew/bin/node"
		)
		Vitest.assert.strictEqual(pickNodeBinary(Option.some(""), ["/opt/homebrew/bin/node"]), "/opt/homebrew/bin/node")
		Vitest.assert.strictEqual(pickNodeBinary(Option.none(), []), DEFAULT_NODE_BINARY)
	})
})
