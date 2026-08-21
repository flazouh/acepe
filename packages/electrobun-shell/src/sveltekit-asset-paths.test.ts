import { expect, test } from "bun:test"

import { rewriteSvelteKitRootAbsolutePaths } from "./sveltekit-asset-paths.ts"

test("rewriteSvelteKitRootAbsolutePaths makes kit assets load under views://mainview", () => {
	const html = `<link href="/favicon.png" />
<link href="/_app/immutable/entry/start.js" rel="modulepreload">
<script src="/_app/immutable/entry/app.js"></script>`
	expect(rewriteSvelteKitRootAbsolutePaths(html)).toBe(`<link href="./favicon.png" />
<link href="./_app/immutable/entry/start.js" rel="modulepreload">
<script src="./_app/immutable/entry/app.js"></script>`)
})

test("rewriteSvelteKitRootAbsolutePaths leaves already-relative kit assets alone", () => {
	const html = `<link href="./_app/immutable/entry/start.js" rel="modulepreload">`
	expect(rewriteSvelteKitRootAbsolutePaths(html)).toBe(html)
})
