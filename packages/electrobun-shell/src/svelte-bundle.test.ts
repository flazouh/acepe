import { expect, test } from "bun:test"

import { svelteBundleCopy, svelteBundleViewUrl } from "./svelte-bundle.ts"

test("copy map places the svelte build at the mainview root", () => {
	expect(svelteBundleCopy["build/"]).toBe("views/mainview/")
})

test("window url matches the copied svelte index", () => {
	expect(svelteBundleViewUrl).toBe("views://mainview/index.html")
})
