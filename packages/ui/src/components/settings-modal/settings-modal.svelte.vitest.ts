import { cleanup, fireEvent, render } from "@testing-library/svelte"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module")
	const { dirname, join } = await import("node:path")
	const require = createRequire(import.meta.url)
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	)

	return import(/* @vite-ignore */ svelteClientPath)
})

import SettingsModal from "./settings-modal.svelte"
import type { SettingsModalViewModel } from "./settings-modal-state.js"

afterEach(() => {
	cleanup()
})

const model: SettingsModalViewModel = {
	openLabel: "Settings",
	closeLabel: "Close",
	title: "Appearance",
	uiFontLabel: "Interface font size",
	uiFontDescription: "Scales the review modal.",
	codeFontLabel: "Code font size",
	codeFontDescription: "Scales diffs.",
	reviewPreviewLabel: "Review modal",
	reviewPreviewText: "Review this change",
	diffPreviewLabel: "Diff",
	diffPreviewText: "+ persisted setting",
	open: true,
	uiFontSize: 16,
	codeFontSize: 13,
	uiMin: 12,
	uiMax: 20,
	codeMin: 10,
	codeMax: 18,
}

describe("SettingsModal", () => {
	it("renders font sizes and the review and diff previews", () => {
		const view = render(SettingsModal, {
			props: {
				model,
				onOpen: () => undefined,
				onClose: () => undefined,
				onDecreaseUiFont: () => undefined,
				onIncreaseUiFont: () => undefined,
				onDecreaseCodeFont: () => undefined,
				onIncreaseCodeFont: () => undefined,
			},
		})

		expect(view.getByTestId("settings-modal").getAttribute("data-ui-font-size")).toBe("16")
		expect(view.getByTestId("settings-modal").getAttribute("data-code-font-size")).toBe("13")
		expect(view.getByTestId("settings-shell").getAttribute("data-ui-font-size")).toBe("16")
		expect(view.getByTestId("review-modal-preview").textContent).toContain("Review this change")
		expect(view.getByTestId("diff-preview").className).toContain("app-code-font")
		expect(view.getByTestId("diff-preview").textContent).toContain("+ persisted setting")
	})

	it("calls onIncreaseUiFont from the stepper", async () => {
		const onIncreaseUiFont = vi.fn()
		const view = render(SettingsModal, {
			props: {
				model,
				onOpen: () => undefined,
				onClose: () => undefined,
				onDecreaseUiFont: () => undefined,
				onIncreaseUiFont,
				onDecreaseCodeFont: () => undefined,
				onIncreaseCodeFont: () => undefined,
			},
		})
		await fireEvent.click(view.getByTestId("settings-ui-font-increase"))
		expect(onIncreaseUiFont).toHaveBeenCalledTimes(1)
	})
})
