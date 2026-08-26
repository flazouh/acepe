import { expect, test } from "bun:test"

import { readDevWindowUrl } from "./dev-window-url.ts"

test("no dev url keeps the copied svelte bundle", () => {
	expect(readDevWindowUrl(undefined)).toBeNull()
})

test("an http origin becomes the window url", () => {
	expect(readDevWindowUrl("http://localhost:1420")).toBe("http://localhost:1420")
})

test("surrounding whitespace is trimmed", () => {
	expect(readDevWindowUrl("  https://localhost:1420  ")).toBe("https://localhost:1420")
})

test("a non http value is ignored", () => {
	expect(readDevWindowUrl("")).toBeNull()
	expect(readDevWindowUrl("file:///tmp/index.html")).toBeNull()
	expect(readDevWindowUrl("localhost:1420")).toBeNull()
})
