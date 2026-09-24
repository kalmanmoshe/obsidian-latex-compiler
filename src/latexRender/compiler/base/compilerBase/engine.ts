import { StringMap } from "src/settings/settings";

export enum EngineStatus {
	Init,
	Ready,
	Busy,
	Unresponsive,
	Failed
}

interface EngineTask {
	cmd: EngineCommands;
	[key: string]: unknown;
}

export interface WorkerMessage {
	cmd: EngineCommands;
	result?: unknown;
	[key: string]: unknown;
}

export enum EngineCommands {
	WorkerError = 'workererror',
	WorkerRejection = 'workerrejection',
	Compilelatex = 'compilelatex',
	Grace = 'grace',
	Settexliveurl = 'settexliveurl',
	Mkdir = 'mkdir',
	Compileformat = 'compileformat',
	Writecache = 'writecache',
	Resolvefile = 'resolvefile',
	Fetchfile = 'fetchfile',
	FetchWorkFiles = 'fetchWorkFiles',
	FetchCache = 'fetchcache',
	Writetexfile = 'writetexfile',
	Setmainfile = 'setmainfile',
	Writefile = 'writefile',
	RegisterResolvedFile = 'registerResolvedFile',
	Flushcatche = 'flushcache',
	FlushWorkDirectory = 'flushworkcache',
	Removefile = 'removefile',
	Compilepdf = 'compilepdf',
}

export enum CompileStatus {
	Success = 0,
	ProcessingError = 20,
	CompileError = 1,
	FileNotFound = -253,
	EngineCrashed = -254,
}

export class CompileResult {
	pdf: Uint8Array;
	status: number = -254;
	log: string = 'No log';

	constructor(pdf: Uint8Array | undefined, status: number, log: string) {
		if (pdf) this.pdf = pdf;
		this.status = status;
		this.log = log;
	}

	isStatus(status: CompileStatus): boolean {
		return this.status === Number(status);
	}
}

export interface ResolvedFile {
	requestedPath: string;
	requestingPath: string | null;
	format: number;
	virtualPath: string;
}

export interface LatexCompilationSession {
	handleWorkerMessage(
		message: WorkerMessage,
		worker: Worker,
	): Promise<boolean>;

	getResolvedFiles(): (ResolvedFile & {
		content: string | Uint8Array;
	})[];
}

export default class LatexEngine {
	protected worker: Worker | undefined;
	protected engineStatus: EngineStatus = EngineStatus.Init;
	protected tasks: string[] = [];

	constructor(
		private readonly createWorker: () => Promise<Worker>,
		//name of the engine, used for logging and debugging
		readonly engineName: string,
	) { }

	async loadEngine(): Promise<void> {
		if (this.worker) {
			throw new Error('Other instance is running, abort()');
		}

		this.engineStatus = EngineStatus.Init;

		this.worker = await this.createWorker();

		await new Promise<void>((resolve, reject) => {
			this.worker!.onmessage = (ev: MessageEvent<WorkerMessage>) => {
				const data = ev.data;

				if (data.result === 'ok') {
					this.engineStatus = EngineStatus.Ready;
					resolve();
					return;
				}

				this.worker?.terminate();
				this.worker = undefined;
				this.engineStatus = EngineStatus.Failed;

				reject(new Error(`${this.engineName} failed to initialize`));
			};

			this.worker!.onerror = (ev: ErrorEvent) => {
				this.worker?.terminate();
				this.worker = undefined;
				this.engineStatus = EngineStatus.Failed;

				reject(new Error(`${this.engineName} worker error: ${ev.message}`));
			};
		});
	}

	isReady(): boolean {
		return this.engineStatus === EngineStatus.Ready;
	}

	getEngineStatus(): EngineStatus {
		return this.engineStatus;
	}

	protected checkEngineStatus(cmd?: string): this is { worker: Worker } {
		if (!this.isReady()) {
			const errorMessage =
				`Engine is not ready! engineStatus: ${EngineStatus[this.engineStatus]}, last task: ${this.tasks[this.tasks.length - 1]}.` +
				(cmd ? `, Attempted command: ${cmd}` : '');
			throw new Error(errorMessage);
		}
		if (this.worker === undefined) {
			throw new Error('Engine is not initialized! Please call loadEngine() first.');
		}
		return true;
	}

	async compileLaTeX(session?: LatexCompilationSession): Promise<CompileResult> {
		const data = await this.task<{
			pdf?: Uint8Array;
			status: number;
			log: string;
		}>(
			{
				cmd: EngineCommands.Compilelatex,
			},
			session ? (message) => session.handleWorkerMessage(message, this.worker!) : undefined
		);
		return new CompileResult(
			data.pdf ? new Uint8Array(data.pdf) : undefined,
			data.status,
			data.log,
		);
	}

	async compilePDF(): Promise<CompileResult> {
		const data = await this.task<{
			pdf?: Uint8Array;
			status: number;
			log: string;
		}>({ cmd: EngineCommands.Compilepdf });

		return new CompileResult(
			data.pdf ? new Uint8Array(data.pdf) : undefined,
			data.status,
			data.log,
		);
	}

	async compileFormat(): Promise<void> {
		const data = await this.task<{ pdf: Uint8Array; log?: string }>({
			cmd: EngineCommands.Compileformat,
		});
		const formatBlob = new Blob([new Uint8Array(data.pdf)], {
			type: 'application/octet-stream',
		});
		const formatURL = URL.createObjectURL(formatBlob);
		window.setTimeout(() => URL.revokeObjectURL(formatURL), 30000);
		console.log(`Engine ${this.engineName} download format file via ` + formatURL);
	}

	async fetchCacheData() {
		const recordToString = (record: Record<string, number>) =>
			Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)]));

		const data = await this.task<{
			texlive404: Record<string, number>;
			texlive200: Record<string, string>;
			font404: Record<string, number>;
			font200: Record<string, string>;
			downloadedTexLiveFiles: string[];
		}>({
			cmd: EngineCommands.FetchCache,
		});

		if (!data) {
			throw new Error(`Engine ${this.engineName} received no cache data from the worker.`);
		}

		return {
			missingPackages: recordToString(data.texlive404),
			cachedPackages: data.texlive200,
			missingFonts: recordToString(data.font404),
			cachedFonts: data.font200,

			downloadedTexLiveFiles: data.downloadedTexLiveFiles,
		};
	}

	writeCacheData(
		texlive404_cache: StringMap,
		texlive200_cache: StringMap,
		font404_cache: StringMap,
		font200_cache: StringMap,
	) {
		return this.task({
			cmd: EngineCommands.Writecache,
			texlive404_cache,
			texlive200_cache,
			font404_cache,
			font200_cache,
		});
	}

	async fetchWorkFiles() {
		return this.task<{ file: string[] }>({
			cmd: EngineCommands.FetchWorkFiles,
		});
	}

	/**
	 * Fetches a list of TeX files from a virtual file system and returns them contents.
	 *
	 * @param filenames - An array of filenames to fetch from the virtual file system.
	 */
	async fetchTexFiles(fileNames: string[]) {
		const files = [];
		for (const fileName of fileNames) {
			const data = await this.task<{ content: Uint8Array<ArrayBuffer> }>({
				cmd: EngineCommands.Fetchfile,
				fileName,
			});
			// Is intentionally designed to skip over files that do not exist, rather than throwing an error.
			if (!data || !data.content) {
				continue;
			}
			const fileContent = new Uint8Array(data.content);
			files.push({ name: fileName, content: fileContent });
		}
		return files;
	}

	//todo: take down timer revert to 15000 when loding pkg for the first time it taks a lot of time
	task<T = void>(
		task: EngineTask,
		onIntermediateMessage?: (message: WorkerMessage) => Promise<boolean> | boolean,
		timeoutMs = 1500000
	): Promise<T> {
		const command = task.cmd;

		this.checkEngineStatus(command);
		this.engineStatus = EngineStatus.Busy;
		this.tasks.push(command);

		const worker = this.worker!;

		return new Promise<T>((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				worker.onmessage = null;
				worker.onerror = null;
			};

			const ok = (v: T) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(v);
			};

			const fail = (e: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(e instanceof Error ? e : new Error(String(e)));
			};

			const timer = window.setTimeout(() => {
				// Mark as unresponsive so closeWorker() terminates.
				this.engineStatus = EngineStatus.Unresponsive;
				fail(new Error(`Engine timeout on cmd=${command} after ${timeoutMs}ms`));
			}, timeoutMs);

			worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
				const message = event.data;

				void (async () => {
					if (
						message?.cmd === EngineCommands.WorkerError ||
						message?.cmd === EngineCommands.WorkerRejection
					) {
						this.engineStatus = EngineStatus.Failed;
						fail(
							new Error(
								`Engine ${this.engineName} worker error: ${JSON.stringify(message) ?? 'unknown error'}`,
							),
						);
						return;
					}

					if (onIntermediateMessage) {
						const handled = await onIntermediateMessage(message);

						if (handled) {
							return;
						}
					}

					// IMPORTANT: don't throw on other messages
					if (message?.cmd !== command) return;

					window.clearTimeout(timer);

					this.engineStatus = EngineStatus.Ready;

					const {
						result: _result,
						cmd: _cmd,
						...data
					} = message;

					ok(Object.keys(data).length ? (data as T) : (undefined as T));

				})().catch((err) => {
					window.clearTimeout(timer);
					this.engineStatus = EngineStatus.Failed;
					fail(err);
				});
			};

			worker.onerror = (err: ErrorEvent) => {
				window.clearTimeout(timer);
				this.engineStatus = EngineStatus.Failed;
				console.error(`Engine ${this.engineName} worker error:`, err);
				fail(new Error(`Engine ${this.engineName} worker error: ${err.message}`));
			};

			worker.postMessage(task);
		});
	}

	writeTexFSFile(filename: string, srcCode: Uint8Array | string) {
		return this.task({
			cmd: EngineCommands.Writetexfile,
			url: filename,
			src: srcCode,
		});
	}

	setEngineMainFile(filename: string) {
		return this.task({ cmd: EngineCommands.Setmainfile, url: filename });
	}

	/**
	 * Writes a file to the in-memory filesystem managed by the LaTeX worker.
	 *
	 * @param filename - The name (or URL path) of the file to be written.
	 * @param srcCode - The source code or content to write into the file.
	 */
	writeMemFSFile(filename: string, srcCode: string | Uint8Array) {
		return this.task({
			cmd: EngineCommands.Writefile,
			url: filename,
			src: srcCode,
		});
	}

	/**
	 * Removes a file to the in-memory filesystem managed by the LaTeX worker.
	 *
	 * @param filename - The name (or URL path) of the file to be removed.
	 */
	removeMemFSFile(filename: string) {
		return this.task({ cmd: EngineCommands.Removefile, url: filename });
	}

	registerResolvedFile(file: ResolvedFile) {
		return this.task({ cmd: EngineCommands.RegisterResolvedFile, ...file });
	}

	makeMemFSFolder(folder: string) {
		if (!folder || folder === '/') return Promise.resolve();
		return this.task({ cmd: EngineCommands.Mkdir, url: folder });
	}

	flushWorkCache(): Promise<void> {
		return this.task({ cmd: EngineCommands.FlushWorkDirectory });
	}

	flushCache(): Promise<void> {
		return this.task({ cmd: EngineCommands.Flushcatche });
	}

	setTexliveEndpoint(url: string): Promise<void> {
		return this.task({ cmd: EngineCommands.Settexliveurl, url });
	}

	closeWorker(): void {
		if (this.worker) {
			if (this.engineStatus === EngineStatus.Unresponsive) {
				try {
					// If it’s hung, it will never process "grace" anyway.
					// Terminate is the only reliable stop.
					this.worker.terminate();
				} catch (err) {
					console.error(`Error terminating engine ${this.engineName} worker:`, err);
				}
			} else {
				this.worker.postMessage({ cmd: EngineCommands.Grace });
			}
			this.worker = undefined;
		}
		this.engineStatus = EngineStatus.Init;
	}
}
