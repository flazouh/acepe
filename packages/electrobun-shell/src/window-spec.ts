import { svelteBundleViewUrl } from "./svelte-bundle.ts"

export type WindowFrame = {
	readonly width: number
	readonly height: number
	readonly x: number
	readonly y: number
}

/**
 * hiddenInset drops the native title bar and insets the traffic lights over
 * the web content. The app top bar already reserves 4.25rem on its left for
 * them, so the window chrome is the app's own row and nothing sits above it.
 */
export type WindowTitleBarStyle = "hiddenInset"

export type AcepeWindowSpec = {
	// electrobun-qa injects its preload here when the QA surface is enabled.
	// Null in signed builds, where the preload and host are dropped entirely.
	readonly preload: string | null
	readonly title: string
	readonly url: string
	readonly frame: WindowFrame
	readonly titleBarStyle: WindowTitleBarStyle
	readonly activate: true
	readonly hidden: false
}

export const acepeWindowSpec: AcepeWindowSpec = {
	preload: null,
	title: "Acepe",
	url: svelteBundleViewUrl,
	frame: {
		width: 1512,
		height: 982,
		x: 0,
		y: 0,
	},
	titleBarStyle: "hiddenInset",
	activate: true,
	hidden: false,
}
