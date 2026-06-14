/**
 * Clipboard or picked image stored by ref id for `@[image_ref:UUID]` composer tokens.
 */
export interface InlineImageReference {
	readonly displayName: string;
	readonly extension: string;
	readonly content: string;
	readonly path: string;
}
