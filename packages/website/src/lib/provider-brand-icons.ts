import {
	hugeiconsIconDataUri,
	type HugeiconsIconName,
} from "@acepe/ui/icons";
import type { ProviderBrand } from "@acepe/ui";

export type Theme = "light" | "dark";

const PROVIDER_BRAND_ICON_NAMES: Record<ProviderBrand, HugeiconsIconName> = {
	"claude-code": "robot",
	codex: "code",
	cursor: "code",
	copilot: "sparkle",
	opencode: "terminal",
	custom: "robot",
};

export function getProviderBrandIconSrc(
	providerBrand: ProviderBrand | null | undefined,
	theme: Theme,
): string {
	const iconName = PROVIDER_BRAND_ICON_NAMES[providerBrand ?? "custom"];
	const color = theme === "dark" ? "#fafafa" : "#27272a";
	return hugeiconsIconDataUri(iconName, color);
}
