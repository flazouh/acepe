export type ProjectFileSystemDialogState = {
	id: string;
	projectPath: string;
	filePath: string;
	projectName: string | null;
	projectColor: string | null;
	projectIconSrc: string | null;
	title: string | null;
	targetLine: number | null;
	targetColumn: number | null;
};

export type OpenProjectFileSystemDialogOptions = {
	projectName?: string;
	projectColor?: string;
	projectIconSrc?: string | null;
	title?: string | null;
	targetLine?: number;
	targetColumn?: number;
};
