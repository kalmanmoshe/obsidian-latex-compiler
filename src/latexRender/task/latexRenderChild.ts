import { MarkdownRenderChild } from "obsidian";

export class LatexRenderChild extends MarkdownRenderChild {
	private objectUrl?: string;
	private rendererDisposer?: () => void;
	private unloaded = false;

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

		super.onunload();
	}
}