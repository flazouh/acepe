export type RawEditorMode = "read" | "write";

export interface RawEditorConfig {
	useCodeMirror: true;
	readonly: boolean;
}

export function getRawEditorConfig(mode: RawEditorMode): RawEditorConfig {
	if (mode === "read") {
		return {
			useCodeMirror: true,
			readonly: true,
		};
	}

	return {
		useCodeMirror: true,
		readonly: false,
	};
}
