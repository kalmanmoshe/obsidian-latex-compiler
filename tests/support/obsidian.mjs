export const Platform = { isDesktop: true, isMobile: false, isIosApp: false };

export function normalizePath(path) {
	return path
		.replaceAll('\\', '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\/+|\/+$/g, '');
}

export class TFolder {
	constructor(path = '', parent = null) {
		this.path = path;
		this.name = path.split('/').pop();
		this.parent = parent;
		this.children = [];
	}
}

export class TFile {
	constructor(path = '', parent = null) {
		this.path = path;
		this.name = path.split('/').pop();
		this.extension = this.name.split('.').pop();
		this.basename = this.name.slice(0, -(this.extension.length + 1));
		this.parent = parent;
	}
}

export class Notice {}
export class FileSystemAdapter {}
export class MarkdownRenderChild {}
export class MarkdownView {}

String.prototype.contains ??= String.prototype.includes;
