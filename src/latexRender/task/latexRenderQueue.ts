import async, { AsyncPriorityQueue } from 'async';
import { LatexTask, LatexTaskPriority } from './latexTask';

type InternalTask<T> = {
	data: T;
	callback: (data: T) => void | Promise<void>;
	next: InternalTask<T> | null;
};

type PriorityQueueObject<T> = AsyncPriorityQueue<T> & {
	_tasks: {
		head: InternalTask<T> | null;
		tail: InternalTask<T> | null;
		length: number;
		remove: (testFn: (node: InternalTask<T>) => boolean) => void;
	};
};

export class LatexRenderQueue {
	private queue: PriorityQueueObject<LatexTask>;

	constructor(private renderTask: (task: LatexTask) => Promise<boolean>) {
		this.configQueue();
	}

	push(task: LatexTask, priority: LatexTaskPriority) {
		const blockId = task.getBlockId();

		this.queue.remove((node) => node.data.getBlockId() === blockId);

		const index = this.queue.running() + this.queue.length();

		task.el.appendChild(createWaitingCountdown(index));
		const completion = this.queue.push(task, priority);

		updateQueueCountdown(this.queue);
		return completion;
	}

	removeFromWaiting(filterFn: (task: LatexTask) => boolean) {
		this.queue.remove((node) => filterFn(node.data));
		updateQueueCountdown(this.queue);
	}

	abortAllWaiting() {
		let node = this.queue._tasks.head;

		while (node) {
			node.data.el.innerHTML = '';
			node = node.next;
		}

		this.queue.kill();
	}

	rebuild() {
		this.abortAllWaiting();
		this.configQueue();
	}

	length() {
		return this.queue.length();
	}

	running() {
		return this.queue.running();
	}

	idle() {
		return this.queue.idle();
	}

	getWaitingTasks(): LatexTask[] {
		const tasks: LatexTask[] = [];

		let node = this.queue._tasks.head;

		while (node) {
			tasks.push(node.data);
			node = node.next;
		}

		return tasks;
	}

	configQueue() {
		this.queue = async.priorityQueue(async (task: LatexTask) => {
			try {
				await this.renderTask(task);
			} catch (err) {
				console.error(
					'Queue worker crashed:',
					err,
					task.getDebugInfo(),
				);
			} finally {
				updateQueueCountdown(this.queue);
			}
		}, 1) as PriorityQueueObject<LatexTask>; // Concurrency is set to 1, so tasks run one at a time
	}
}

const updateQueueCountdown = (queue: PriorityQueueObject<LatexTask>) => {
	let taskNode = queue._tasks.head;
	let index = queue.running();
	while (taskNode) {
		const task = taskNode.data;
		const countdown = task.el.querySelector(".latex-compiler-countdown");
		if (countdown) countdown.textContent = index.toString();
		else console.warn(`Countdown not found for task ${index}`);
		taskNode = taskNode.next;
		index++;
	}
};

function createWaitingCountdown(index: number) {
	const parentContainer = Object.assign(activeDocument.createElement('div'), {
		className: 'latex-compiler-loader-parent-container',
	});

	const loader = Object.assign(activeDocument.createElement('div'), {
		className: 'latex-compiler-loader',
	});

	const countdown = Object.assign(activeDocument.createElement('div'), {
		className: 'latex-compiler-countdown',
		textContent: index.toString(),
	});
	parentContainer.appendChild(loader);
	parentContainer.appendChild(countdown);
	return parentContainer;
}
