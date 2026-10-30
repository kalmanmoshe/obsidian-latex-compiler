import { MarkdownRenderChild } from "obsidian";
import LatexCompilerPlugin from "src/main";

export class LatexRenderChild extends MarkdownRenderChild {
	private readonly plugin: LatexCompilerPlugin;
	private readonly sourcePath: string;
	private objectUrl?: string;
	private rendererDisposer?: () => void;
	private unloaded = false;

	constructor(containerEl: HTMLElement, plugin: LatexCompilerPlugin, sourcePath: string) {
		super(containerEl);
		this.plugin = plugin;
		this.sourcePath = sourcePath;
	}

	get isUnloaded(): boolean {
		return this.unloaded;
	}

	setRendererDisposer(disposer: () => void): void {
		this.disposeRenderer();

		if (this.unloaded) {
			disposer();
		} else {
			this.rendererDisposer = disposer;
		}
	}

	disposeRenderer(): void {
		const disposer = this.rendererDisposer;
		this.rendererDisposer = undefined;
		disposer?.();
	}

	setObjectUrl(objectUrl: string): void {
		if (this.unloaded) {
			URL.revokeObjectURL(objectUrl);
			return;
		}
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = objectUrl;
	}

	onunload(): void {
		this.unloaded = true;
		this.disposeRenderer();

		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = undefined;
		}
		this.plugin.latexRenderer.cache.markCandidateForCleanup(this.sourcePath);

		super.onunload();
	}
}
