import { svelteBundleViewUrl } from "./svelte-bundle.ts"

export type WindowFrame = {
	readonly width: number
	readonly height: number
	readonly x: number
	readonly y: number
}

export type AcepeWindowSpec = {
	// electrobun-qa injects its preload here when the QA surface is enabled.
	// Null in signed builds, where the preload and host are dropped entirely.
	readonly preload: string | null
	readonly title: string
	readonly url: string
	readonly frame: WindowFrame
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
	activate: true,
	hidden: false,
}
