import type { LatexTask, LatexTaskPriority } from './latexTask';
import type { CacheContent } from '../cache/cacheBase/cacheBase';

type Outcome = { ok: true; data: CacheContent } | { ok: false; error: unknown };

type RenderRequest = {
	task: LatexTask;
	loader: HTMLElement;
	settled: boolean;
	finish: () => void;
};

type Job = {
	key: string;
	priority: LatexTaskPriority;
	sequence: number;
	state: 'waiting' | 'running';
	requests: Set<RenderRequest>;
};

export type QueueHandlers = {
	/** Verify this request's source; false means no further display is needed. */
	validate: (task: LatexTask) => Promise<boolean>;
	/** Read the cache, or compile and cache. Return data without changing any pane. */
	prepare: (task: LatexTask) => Promise<CacheContent>;
	/** Render a separate display for this request. */
	render: (task: LatexTask, data: CacheContent) => Promise<void>;
	showError: (task: LatexTask, error: unknown) => void | Promise<void>;
};

export class LatexRenderQueue {
	private readonly jobs = new Map<string, Job>();
	private activeJob?: Job;
	private draining = false;
	private nextSequence = 0;
	private disposed = false;

	constructor(private readonly handlers: QueueHandlers) {}

	push(task: LatexTask, priority: LatexTaskPriority): Promise<void> {
		if (this.disposed || !task.isStillValid()) return Promise.resolve();

		// The stem includes raw content hash, source context and pipeline.
		// The final output format must match as well.
		const key = JSON.stringify([task.getStem(), task.resultFormat]);
		let job = this.jobs.get(key);
		if (!job) {
			job = {
				key,
				priority,
				sequence: this.nextSequence++,
				state: 'waiting',
				requests: new Set<RenderRequest>(),
			};
			// Register before scheduling, so synchronous pushes can join.
			this.jobs.set(key, job);
		}

		const loader = createWaitingCountdown(0);
		task.el.appendChild(loader);
		const completion = new Promise<void>((finish) => {
			job.requests.add({ task, loader, finish, settled: false });
		});

		if (job.state === 'waiting' && priority < job.priority) {
			job.priority = priority;
			// Promotion moves the job behind jobs already waiting at this priority.
			job.sequence = this.nextSequence++;
		}
		this.updateQueueCountdown();
		this.scheduleDrain();
		return completion;
	}

	/** Cancel matching requests in waiting jobs, preserving other subscribers. */
	removeFromWaiting(filterFn: (task: LatexTask) => boolean): void {
		for (const job of this.getWaitingJobs()) {
			for (const request of job.requests) {
				if (!filterFn(request.task)) continue;
				this.settle(request);
				job.requests.delete(request);
			}
			if (job.requests.size === 0) {
				this.jobs.delete(job.key);
			}
		}
		this.updateQueueCountdown();
	}

	abortAllWaiting(): void {
		this.removeFromWaiting(() => true);
	}

	rebuild(): void {
		// Preserve the active drain; never overlap compiler jobs.
		this.abortAllWaiting();
	}

	/** Called when this queue's compiler is stopped or the plugin unloads. */
	dispose(): void {
		this.disposed = true;
		this.abortAllWaiting();
		for (const job of this.jobs.values()) {
			for (const request of job.requests) this.settle(request);
			job.requests.clear();
		}
		this.jobs.clear();
	}

	/** Counts shared jobs, rather than the number of requesting panes. */
	length(): number {
		return this.getWaitingJobs().length;
	}
	running(): number {
		return this.activeJob === undefined ? 0 : 1;
	}
	idle(): boolean {
		return this.activeJob === undefined && this.length() === 0;
	}

	getWaitingTasks(): LatexTask[] {
		return this.getWaitingJobs().flatMap((job) =>
			[...job.requests].map((request) => request.task),
		);
	}

	/** Defer startup so synchronous pushes can join or change priority. */
	private scheduleDrain(): void {
		if (this.draining || this.disposed) return;
		// Lock before deferring. Multiple push() calls can only start one drain.
		this.draining = true;
		void Promise.resolve()
			.then(() => this.drain())
			.catch((error: unknown) => {
				console.error('LaTeX scheduler failed:', error);
			});
	}

	private async drain(): Promise<void> {
		try {
			while (!this.disposed) {
				// This is also the ordering used by the countdown.
				const job = this.getWaitingJobs()[0];
				if (!job) break;

				this.activeJob = job;
				job.state = 'running';
				try {
					this.updateQueueCountdown();
					await this.runJob(job);
				} catch (error) {
					console.error('LaTeX queue worker crashed:', error);
				} finally {
					if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
					this.activeJob = undefined;
					for (const request of job.requests) this.settle(request);
					job.requests.clear();
					this.updateQueueCountdown();
				}
			}
		} finally {
			this.draining = false;
			// Recover if work remains after an unexpected scheduler-level error.
			if (!this.disposed && this.length() > 0) this.scheduleDrain();
		}
	}

	private async runJob(job: Job): Promise<void> {
		let source: LatexTask | undefined;
		for (const request of job.requests) {
			if (await this.validateRequest(request)) {
				source = request.task;
				break;
			}
		}
		if (!source || this.disposed) {
			if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
			return;
		}

		let outcome: Outcome;
		try {
			outcome = { ok: true, data: await this.handlers.prepare(source) };
		} catch (error) {
			outcome = { ok: false, error };
		}

		const delivered = new Set<RenderRequest>();
		while (!this.disposed) {
			const batch = [...job.requests].filter(
				(request) => !request.settled && !delivered.has(request),
			);
			// No await between this final check and removing the map entry:
			// a late arrival must either join a batch or start a new job.
			if (batch.length === 0) {
				if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
				return;
			}
			for (const request of batch) delivered.add(request);
			const results = await Promise.allSettled(
				batch.map(async (request) => {
					if (!(await this.validateRequest(request))) return;
					if (this.disposed || request.settled) return;
					if (outcome.ok) {
						await this.handlers.render(request.task, outcome.data);
					} else {
						await this.handlers.showError(request.task, outcome.error);
					}
				}),
			);
			for (const result of results) {
				if (result.status === 'rejected') {
					console.error('LaTeX pane display failed:', result.reason);
				}
			}
			// Loop again for panes that joined while display was awaiting.
		}
	}

	private async validateRequest(request: RenderRequest): Promise<boolean> {
		if (this.disposed || request.settled) return false;
		try {
			if (
				request.task.isStillValid() &&
				(await this.handlers.validate(request.task))
			) {
				if (!this.disposed && !request.settled && request.task.isStillValid())
					return true;
			}
		} catch (error) {
			if (!this.disposed && !request.settled && request.task.isStillValid()) {
				try {
					await this.handlers.showError(request.task, error);
				} catch (displayError) {
					console.error('LaTeX validation display failed:', displayError);
				}
			}
		}
		this.settle(request);
		return false;
	}

	private settle(request: RenderRequest): void {
		if (request.settled) return;
		request.settled = true;
		// Remove this request's exact loader, never another request's DOM.
		request.loader.remove();
		request.finish();
	}

	private getWaitingJobs(): Job[] {
		return [...this.jobs.values()]
			.filter((job) => job.state === 'waiting')
			.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
	}

	private updateQueueCountdown(): void {
		for (const job of this.jobs.values()) {
			if (job.state === 'running') this.updateJobCountdown(job, 0);
		}
		let position = this.running();
		for (const job of this.getWaitingJobs()) {
			this.updateJobCountdown(job, position++);
		}
	}

	private updateJobCountdown(job: Job, position: number): void {
		for (const request of job.requests) {
			const countdown = request.loader.querySelector(
				'.latex-compiler-countdown',
			);
			if (countdown) countdown.textContent = String(position);
		}
	}
}

function createWaitingCountdown(index: number): HTMLElement {
	const parentContainer = createFragment().createDiv({
		cls: 'latex-compiler-loader-parent-container',
	});
	parentContainer.createDiv({ cls: 'latex-compiler-loader' });
	parentContainer.createDiv({
		cls: 'latex-compiler-countdown',
		text: String(index),
	});
	return parentContainer;
}
