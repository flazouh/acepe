export type ProjectFileSystemDialogState = {
	id: string;
	projectPath: string;
	/** Null when the dialog opens on the project tree with no file selected. */
	filePath: string | null;
	projectName: string | null;
	projectColor: string | null;
	title: string | null;
	targetLine: number | null;
	targetColumn: number | null;
};

export type OpenProjectFileSystemDialogOptions = {
	projectName?: string;
	projectColor?: string;
	title?: string | null;
	targetLine?: number;
	targetColumn?: number;
};
