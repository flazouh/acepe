import { expect, test } from "bun:test"

import { svelteBundleCopy, svelteBundleViewUrl } from "./svelte-bundle.ts"

test("copy map places the svelte build at the mainview root", () => {
	expect(svelteBundleCopy["build/"]).toBe("views/mainview/")
})

test("window url is the mainview directory root, not index.html", () => {
	// SvelteKit routes on pathname: "/index.html" matches no route and renders
	// its own 404. The directory form gives "/" and matches the root route.
	expect(svelteBundleViewUrl).toBe("views://mainview/")
})
