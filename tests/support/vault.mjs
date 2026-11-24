import { TFile, TFolder, normalizePath } from './obsidian.mjs';

export function createVault(initialFiles = {}) {
	const root = new TFolder();
	const nodes = new Map([['', root]]);
	const contents = new Map();
	const folders = new Set(['']);
	const leaves = [];

	function folder(path) {
		if (nodes.has(path)) return nodes.get(path);
		const parent = folder(path.split('/').slice(0, -1).join('/'));
		const node = new TFolder(path, parent);
		parent.children.push(node);
		nodes.set(path, node);
		folders.add(path);
		return node;
	}

	function write(path, content) {
		path = normalizePath(path);
		if (!nodes.has(path)) {
			const parent = folder(path.split('/').slice(0, -1).join('/'));
			const file = new TFile(path, parent);
			parent.children.push(file);
			nodes.set(path, file);
		}
		contents.set(path, content);
		return nodes.get(path);
	}

	function remove(path) {
		const file = nodes.get(path);
		if (file?.parent)
			file.parent.children = file.parent.children.filter((child) => child !== file);
		nodes.delete(path);
		contents.delete(path);
	}

	function read(path) {
		if (!contents.has(path)) throw new Error(`File not found: ${path}`);
		return contents.get(path);
	}

	const adapter = {
		exists: async (path) => contents.has(path) || folders.has(path),
		mkdir: async (path) => {
			folders.add(path);
		},
		read: async (path) => {
			const content = read(path);
			if (typeof content !== 'string') throw new Error(`Expected text: ${path}`);
			return content;
		},
		readBinary: async (path) => {
			const content = read(path);
			if (!(content instanceof Uint8Array)) throw new Error(`Expected binary data: ${path}`);
			return content.slice().buffer;
		},
		write: async (path, content) => {
			contents.set(path, content);
		},
		writeBinary: async (path, buffer) => {
			contents.set(path, new Uint8Array(buffer).slice());
		},
		remove: async (path) => {
			contents.delete(path);
		},
		rmdir: async (path) => {
			for (const entry of contents.keys())
				if (entry.startsWith(`${path}/`)) contents.delete(entry);
			for (const entry of folders)
				if (entry === path || entry.startsWith(`${path}/`)) folders.delete(entry);
		},
		list: async (path) => ({
			files: [...contents.keys()].filter(
				(entry) =>
					entry.startsWith(`${path}/`) && !entry.slice(path.length + 1).includes('/'),
			),
			folders: [...folders].filter(
				(entry) =>
					entry.startsWith(`${path}/`) && !entry.slice(path.length + 1).includes('/'),
			),
		}),
	};

	for (const [path, content] of Object.entries(initialFiles)) write(path, content);

	const app = {
		vault: {
			adapter,
			getRoot: () => root,
			getAbstractFileByPath: (path) => nodes.get(path) ?? null,
			getFiles: () => [...nodes.values()].filter((node) => node instanceof TFile),
			read: (file) => adapter.read(file.path),
			cachedRead: (file) => adapter.read(file.path),
			readBinary: (file) => adapter.readBinary(file.path),
		},
		workspace: { getLeavesOfType: () => leaves },
	};

	return { app, contents, leaves, write, remove };
}
