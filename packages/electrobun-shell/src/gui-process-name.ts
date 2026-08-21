export const GUI_PROCESS_FILENAME = "Acepe"

export const BUN_RUNTIME_FILENAME = "bun"

export const bunLauncherWrapperScript = (binaryName: string): string =>
	`#!/bin/sh
exec "$(dirname "$0")/${binaryName}" "$@"
`

export const needsGuiProcessRename = (macosFilenames: ReadonlyArray<string>): boolean => {
	let hasBun = false
	let hasGuiName = false
	for (const name of macosFilenames) {
		if (name === BUN_RUNTIME_FILENAME) {
			hasBun = true
		}
		if (name === GUI_PROCESS_FILENAME) {
			hasGuiName = true
		}
	}
	return hasBun === true && hasGuiName === false
}
