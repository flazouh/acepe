import { cn } from "../../lib/utils.js";

interface RichTokenTextClassOptions {
	singleLine?: boolean;
	className?: string;
}

export function buildRichTokenTextClassName({
	singleLine = false,
	className = "",
}: RichTokenTextClassOptions): string {
	return cn(
		singleLine
			? "inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-bottom"
			: "text-sm leading-relaxed break-words",
		className,
	);
}

export function buildRichTokenTextSegmentClassName({
	singleLine = false,
}: RichTokenTextClassOptions): string {
	return singleLine ? "whitespace-nowrap" : "whitespace-pre-wrap";
}
