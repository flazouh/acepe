import type { DotMatrixLoaderId } from "../loading-icon-preferences.svelte.js";
import type { DotmatrixRegistryId } from "./dotmatrix-registry.js";
import { isTriangleLoaderId, type TriangleLoaderId } from "./triangle-loaders.js";

export type DotmHexLoaderVariant =
	| "dotm-hex-1"
	| "dotm-hex-2"
	| "dotm-hex-3"
	| "dotm-hex-4"
	| "dotm-hex-5"
	| "dotm-hex-6"
	| "dotm-hex-7"
	| "dotm-hex-8"
	| "dotm-hex-9"
	| "dotm-hex-10";

export type DotmTriangleLoaderVariant = TriangleLoaderId | "dotm-triangle-17" | "dotm-triangle-20";

export type DotmatrixLoaderRoute =
	| { kind: "arc" }
	| { kind: "hex"; variant: DotmHexLoaderVariant }
	| { kind: "square-18" }
	| { kind: "triangle"; variant: DotmTriangleLoaderVariant }
	| { kind: "registry"; loaderId: DotmatrixRegistryId };

const HEX_VARIANTS: readonly DotmHexLoaderVariant[] = [
	"dotm-hex-1",
	"dotm-hex-2",
	"dotm-hex-3",
	"dotm-hex-4",
	"dotm-hex-5",
	"dotm-hex-6",
	"dotm-hex-7",
	"dotm-hex-8",
	"dotm-hex-9",
	"dotm-hex-10",
];

function isHexVariant(value: DotMatrixLoaderId): value is DotmHexLoaderVariant {
	return HEX_VARIANTS.some((variant) => variant === value);
}

function isTriangleVariant(value: DotMatrixLoaderId): value is DotmTriangleLoaderVariant {
	if (value === "dotm-triangle-17" || value === "dotm-triangle-20") {
		return true;
	}
	return isTriangleLoaderId(value);
}

export function resolveDotmatrixLoaderRoute(
	variant: DotMatrixLoaderId,
): DotmatrixLoaderRoute {
	if (variant === "arc-spin") {
		return { kind: "arc" };
	}
	if (isHexVariant(variant)) {
		return { kind: "hex", variant };
	}
	if (variant === "dotm-square-18") {
		return { kind: "square-18" };
	}
	if (isTriangleVariant(variant)) {
		return { kind: "triangle", variant };
	}
	return { kind: "registry", loaderId: variant };
}
