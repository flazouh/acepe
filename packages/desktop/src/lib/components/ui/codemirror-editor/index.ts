export { default as CodeMirrorEditor } from "./codemirror-editor.svelte";
export {
	cursorDark,
	cursorDarkHighlightStyle,
	cursorDarkTheme,
	cursorLight,
	cursorLightHighlightStyle,
	cursorLightTheme,
	getCursorThemeExtension,
} from "./cursor-theme.js";
export {
	getLanguageFromFilename,
	loadLanguageByFilename,
	loadLanguageByName,
} from "./language-loader.js";
