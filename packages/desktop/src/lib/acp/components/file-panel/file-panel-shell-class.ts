interface FilePanelShellClassInput {
	flatStyle: boolean;
	isDragging: boolean;
}

export function getFilePanelShellClass(input: FilePanelShellClassInput): string {
	const borderClass = input.flatStyle
		? "border-y border-r border-l-0 border-border rounded-none"
		: "border border-border rounded-lg";
	const draggingClass = input.isDragging ? "select-none" : "";

	return `flex flex-col h-full shrink-0 grow-0 min-h-0 bg-card/50 ${borderClass} overflow-hidden relative ${draggingClass}`;
}
