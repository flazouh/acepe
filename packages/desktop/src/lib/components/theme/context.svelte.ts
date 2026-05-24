import { getContext, setContext } from "svelte";

export type Theme = "light" | "dark" | "system";

type Getter<T> = () => T;

export type ThemeStateProps = {
	theme: Getter<Theme>;
	setTheme: (theme: Theme) => void;
};

class ThemeState {
	readonly props: ThemeStateProps;
	theme = $derived.by(() => this.props.theme());
	setTheme: ThemeStateProps["setTheme"];
	systemPrefersDark = $state(false);

	constructor(props: ThemeStateProps) {
		this.setTheme = props.setTheme;
		this.props = props;

		if (typeof window !== "undefined") {
			const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
			this.systemPrefersDark = mediaQuery.matches;

			const handleChange = (e: MediaQueryListEvent) => {
				this.systemPrefersDark = e.matches;
			};
			mediaQuery.addEventListener("change", handleChange);
		}
	}

	effectiveTheme = $derived.by(() => {
		if (this.theme === "system") {
			return this.systemPrefersDark ? "dark" : "light";
		}
		return this.theme;
	});
}

const SYMBOL_KEY = "scn-theme";
let currentThemeState: ThemeState | null = null;

/**
 * Instantiates a new `ThemeState` instance and sets it in the context.
 *
 * @param props The constructor props for the `ThemeState` class.
 * @returns The `ThemeState` instance.
 */
export function setTheme(props: ThemeStateProps): ThemeState {
	const state = new ThemeState(props);
	currentThemeState = state;
	return setContext(Symbol.for(SYMBOL_KEY), state);
}

/**
 * Retrieves the `ThemeState` instance from the context. This is a class instance,
 * so you cannot destructure it.
 * @returns The `ThemeState` instance.
 */
export function useTheme(): ThemeState {
	const contextTheme = getContext<ThemeState | undefined>(Symbol.for(SYMBOL_KEY));
	if (contextTheme !== undefined) {
		return contextTheme;
	}
	if (currentThemeState !== null) {
		return currentThemeState;
	}
	currentThemeState = new ThemeState({
		theme: () => "system",
		setTheme: () => undefined,
	});
	return currentThemeState;
}
