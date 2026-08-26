/**
 * Dev loop: the window can load the Vite dev server instead of the copied
 * bundle, so a Svelte change reaches the running app through HMR with no
 * rebuild and no relaunch. Anything other than an http(s) origin is ignored,
 * so a stray value can never point the shipped app somewhere else.
 */
export const readDevWindowUrl = (raw: string | undefined): string | null => {
	if (raw === undefined) {
		return null
	}
	const trimmed = raw.trim()
	if (trimmed.startsWith("http://") === false && trimmed.startsWith("https://") === false) {
		return null
	}
	return trimmed
}
