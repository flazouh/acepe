export type SettingsModalViewModel = {
	readonly openLabel: string
	readonly closeLabel: string
	readonly title: string
	readonly uiFontLabel: string
	readonly uiFontDescription: string
	readonly codeFontLabel: string
	readonly codeFontDescription: string
	readonly reviewPreviewLabel: string
	readonly reviewPreviewText: string
	readonly diffPreviewLabel: string
	readonly diffPreviewText: string
	readonly open: boolean
	readonly uiFontSize: number
	readonly codeFontSize: number
	readonly uiMin: number
	readonly uiMax: number
	readonly codeMin: number
	readonly codeMax: number
}

export const canDecreaseFont = (size: number, min: number): boolean => size > min

export const canIncreaseFont = (size: number, max: number): boolean => size < max
