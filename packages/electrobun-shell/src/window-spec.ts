import { svelteBundleViewUrl } from "./svelte-bundle.ts"

export type WindowFrame = {
	readonly width: number
	readonly height: number
	readonly x: number
	readonly y: number
}

export type AcepeWindowSpec = {
	readonly title: string
	readonly url: string
	readonly frame: WindowFrame
}

export const acepeWindowSpec: AcepeWindowSpec = {
	title: "Acepe",
	url: svelteBundleViewUrl,
	frame: {
		width: 1512,
		height: 982,
		x: 0,
		y: 0,
	},
}
