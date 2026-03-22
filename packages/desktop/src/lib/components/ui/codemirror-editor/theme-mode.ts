export type EditorThemeMode = "dark" | "light";

type RootWithClassList = {
	classList: {
		contains: (token: string) => boolean;
	};
};

/**
 * Resolves effective editor theme mode from root class list.
 */
export function resolveEditorThemeMode(root: RootWithClassList): EditorThemeMode {
	return root.classList.contains("dark") ? "dark" : "light";
}

/**
 * Watches root class changes and emits updated theme mode.
 */
export function observeEditorThemeMode(
	root: HTMLElement,
	onThemeModeChange: (mode: EditorThemeMode) => void
): MutationObserver {
	const emitCurrentMode = () => {
		onThemeModeChange(resolveEditorThemeMode(root));
	};

	const observer = new MutationObserver(() => {
		emitCurrentMode();
	});

	observer.observe(root, {
		attributes: true,
		attributeFilter: ["class"],
	});

	emitCurrentMode();

	return observer;
}
