import { TexLiveCacheIndex } from 'src/settings/settings';
import LatexEngine, { CompileResult, EngineStatus, LatexCompilationSession } from './engine';
import { waitFor } from 'src/latexRender/latexRenderer';

export default abstract class LatexCompiler {
	protected engines: LatexEngine[];

	abstract compileLaTeX(session: LatexCompilationSession): Promise<CompileResult>;

	isReady() {
		return this.engines.every((engine) => engine.isReady());
	}

	isResponsive() {
		return this.engines.every(
			(engine) =>
				engine.getEngineStatus() !== EngineStatus.Unresponsive &&
				engine.getEngineStatus() !== EngineStatus.Failed,
		);
	}

	async waitUntilReady(): Promise<void> {
		await waitFor(() => {
			if (!this.isResponsive()) {
				throw new Error('Compiler became unresponsive while waiting.');
			}

			return this.isReady();
		});
	}

	async loadEngines() {
		await Promise.all(this.engines.map((engine) => engine.loadEngine()));
	}

	async setTexliveEndpoint(url: string): Promise<void> {
		return Promise.all(this.engines.map((engine) => engine.setTexliveEndpoint(url))).then(
			() => { },
		);
	}

	async writeTexFSFile(filename: string, srccode: Uint8Array | string): Promise<void> {
		return Promise.all(
			this.engines.map((engine) => engine.writeTexFSFile(filename, srccode)),
		).then(() => { });
	}

	async fetchTexFiles(engine: number, fileNames: string[]) {
		return this.engines[engine].fetchTexFiles(fileNames);
	}

	async flushWorkCache() {
		return Promise.all(this.engines.map((engine) => engine.flushWorkCache()));
	}

	closeWorkers(): void {
		this.engines.forEach((engine) => engine.closeWorker());
	}

	private validate(isSingleEngineRequired: boolean = false) {
		if (!this.engines || this.engines.length === 0) {
			throw new Error('No engines loaded. Please call loadEngine() first.');
		}
		if (isSingleEngineRequired && this.engines.length !== 1) {
			throw new Error(
				'Multiple engines are not supported for this task. Please override the method in the subclass.',
			);
		}
	}

	async writeMemFSFile(filename: string, source: string | Uint8Array): Promise<void> {
		this.validate(true);
		return this.engines[0].writeMemFSFile(filename, source);
	}

	flushCache() {
		this.validate(true);
		return this.engines[0].flushCache();
	}

	fetchCacheData() {
		return Promise.all(this.engines.map((engine) => engine.fetchCacheData()));
	}

	async writeTexLiveCacheIndex(texLiveCacheData: TexLiveCacheIndex): Promise<void> {
		this.validate();
		return Promise.all(
			this.engines.map((engine) =>
				engine.writeCacheData(
					texLiveCacheData.missingPackages,
					texLiveCacheData.cachedPackages,
					texLiveCacheData.missingFonts,
					texLiveCacheData.cachedFonts,
				),
			),
		).then(() => { });
	}

	removeMemFSFile(engine: number, filename: string) {
		this.validate();
		return this.engines[engine].removeMemFSFile(filename);
	}

	setEngineMainFile(engine: number, filename: string) {
		this.validate();
		return this.engines[engine].setEngineMainFile(filename);
	}

	getEnginesStatus() {
		return this.engines.map((engine) => ({
			name: engine.engineName,
			status: engine.getEngineStatus(),
		}));
	}

	getEngineCount() {
		return this.engines.length;
	}
}
