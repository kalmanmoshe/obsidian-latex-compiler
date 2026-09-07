 
export class VirtualFileSystem {
	private autoUseFilePaths = new Set<string>();

	setAutoUseFilePaths(paths: Iterable<string>): void {
		this.autoUseFilePaths = new Set(paths);
	}

	addAutoUseFile(path: string): void {
		this.autoUseFilePaths.add(path);
	}

	removeAutoUseFile(path: string): void {
		this.autoUseFilePaths.delete(path);
	}

	hasAutoUseFile(path: string): boolean {
		return this.autoUseFilePaths.has(path);
	}

	getAutoUseFilePaths(): string[] {
		return [
			...this.autoUseFilePaths,
		];
	}

	flush(): void {
		this.autoUseFilePaths.clear();
	}
}