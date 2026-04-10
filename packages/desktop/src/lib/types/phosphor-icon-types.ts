import type { SVGAttributes } from "svelte/elements";

export type IconWeight = "bold" | "duotone" | "fill" | "light" | "thin" | "regular";

interface IconBaseProps {
	color?: string;
	size?: number | string;
	weight?: IconWeight;
	mirrored?: boolean;
}

export interface IconComponentProps
	extends Omit<SVGAttributes<SVGSVGElement>, keyof IconBaseProps>,
		IconBaseProps {}
