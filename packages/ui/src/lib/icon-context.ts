import { getContext, setContext } from "svelte";

const ICON_CONTEXT_KEY = Symbol("icon-config");

interface IconConfig {
	basePath: string;
}

export function setIconConfig(config: IconConfig): void {
	setContext(ICON_CONTEXT_KEY, config);
}

export function getIconBasePath(): string {
	try {
		return getContext<IconConfig | undefined>(ICON_CONTEXT_KEY)?.basePath ?? "";
	} catch {
		return "";
	}
}
