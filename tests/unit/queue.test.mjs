import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { loadModule } from '../support/load-module.mjs';
import { createTask, deferred, TestElement } from '../support/fakes.mjs';

const { LatexRenderQueue } = await loadModule('src/latexRender/task/latexRenderQueue.ts');

globalThis.createFragment = () => new TestElement();
after(() => {
	delete globalThis.createFragment;
});

function createQueue(t, overrides = {}) {
	const handlers = {
		validate: t.mock.fn(async () => true),
		prepare: t.mock.fn(async () => '<svg/>'),
		render: t.mock.fn(async () => {}),
		showError: t.mock.fn(async () => {}),
		...overrides,
	};
	const queue = new LatexRenderQueue(handlers);
	t.after(() => queue.dispose());
	return { queue, handlers };
}

test('compiles identical requests once and renders each pane independently', async (t) => {
	const { queue, handlers } = createQueue(t);
	const first = createTask('shared');
	const second = createTask('shared');
	const existing = new TestElement('existing-output');
	first.el.appendChild(existing);

	await Promise.all([queue.push(first, 1), queue.push(second, 1)]);

	assert.equal(handlers.prepare.mock.callCount(), 1);
	assert.deepEqual(
		handlers.render.mock.calls.map((call) => call.arguments[0]),
		[first, second],
	);
	assert.deepEqual(first.el.children, [existing]);
	assert.deepEqual(second.el.children, []);
	assert.equal(queue.idle(), true);
});

test('keeps output formats in separate jobs', async (t) => {
	const { queue, handlers } = createQueue(t);
	await Promise.all([
		queue.push(createTask('shared', { resultFormat: 'pdf' }), 1),
		queue.push(createTask('shared', { resultFormat: 'svg' }), 1),
	]);
	assert.equal(handlers.prepare.mock.callCount(), 2);
});

test('runs exports first and preserves arrival order within a priority', async (t) => {
	const order = [];
	const { queue } = createQueue(t, {
		prepare: async (task) => {
			order.push(task.getStem());
			return '<svg/>';
		},
	});
	await Promise.all([
		queue.push(createTask('regular-1'), 1),
		queue.push(createTask('export-1'), 0),
		queue.push(createTask('regular-2'), 1),
		queue.push(createTask('export-2'), 0),
	]);
	assert.deepEqual(order, ['export-1', 'export-2', 'regular-1', 'regular-2']);
});

test('promotes a shared job behind exports already waiting', async (t) => {
	const order = [];
	const { queue } = createQueue(t, {
		prepare: async (task) => {
			order.push(task.getStem());
			return '<svg/>';
		},
	});
	await Promise.all([
		queue.push(createTask('promoted'), 1),
		queue.push(createTask('export'), 0),
		queue.push(createTask('promoted'), 0),
	]);
	assert.deepEqual(order, ['export', 'promoted']);
});

test('cancels one subscriber without cancelling a shared job', async (t) => {
	const { queue, handlers } = createQueue(t);
	const cancelled = createTask('shared');
	const retained = createTask('shared');
	const completions = [queue.push(cancelled, 1), queue.push(retained, 1)];
	queue.removeFromWaiting((task) => task === cancelled);
	await Promise.all(completions);
	assert.equal(handlers.prepare.mock.callCount(), 1);
	assert.deepEqual(
		handlers.render.mock.calls.map((call) => call.arguments[0]),
		[retained],
	);
	assert.deepEqual(cancelled.el.children, []);
});

test('accepts late subscribers and skips panes closed during compilation', async (t) => {
	const started = deferred();
	const compiled = deferred();
	const { queue, handlers } = createQueue(t, {
		prepare: t.mock.fn(() => {
			started.resolve();
			return compiled.promise;
		}),
	});
	const closed = createTask('shared');
	const first = queue.push(closed, 1);
	await started.promise;
	closed.valid = false;
	const retained = createTask('shared');
	const second = queue.push(retained, 1);
	compiled.resolve('<svg/>');
	await Promise.all([first, second]);
	assert.equal(handlers.prepare.mock.callCount(), 1);
	assert.deepEqual(
		handlers.render.mock.calls.map((call) => call.arguments[0]),
		[retained],
	);
});

test('delivers to subscribers that join while a pane is rendering', async (t) => {
	const rendering = deferred();
	const displayed = deferred();
	const first = createTask('shared');
	const { queue, handlers } = createQueue(t, {
		render: t.mock.fn(async (task) => {
			if (task === first) {
				rendering.resolve();
				await displayed.promise;
			}
		}),
	});
	const firstCompletion = queue.push(first, 1);
	await rendering.promise;
	const second = createTask('shared');
	const secondCompletion = queue.push(second, 1);
	displayed.resolve();
	await Promise.all([firstCompletion, secondCompletion]);
	assert.equal(handlers.prepare.mock.callCount(), 1);
	assert.deepEqual(
		handlers.render.mock.calls.map((call) => call.arguments[0]),
		[first, second],
	);
});

test('continues processing after compilation fails', async (t) => {
	const error = new Error('Compilation failed');
	const failed = createTask('failed');
	const next = createTask('next');
	const { queue, handlers } = createQueue(t, {
		prepare: async (task) => {
			if (task === failed) throw error;
			return '<svg/>';
		},
	});
	await Promise.all([queue.push(failed, 1), queue.push(next, 1)]);
	assert.deepEqual(handlers.showError.mock.calls[0].arguments, [failed, error]);
	assert.deepEqual(handlers.render.mock.calls[0].arguments, [next, '<svg/>']);
	assert.equal(queue.idle(), true);
});

test('does not compile a request whose source is no longer present', async (t) => {
	const { queue, handlers } = createQueue(t, { validate: async () => false });
	const task = createTask('removed');
	await queue.push(task, 1);
	assert.equal(handlers.prepare.mock.callCount(), 0);
	assert.deepEqual(task.el.children, []);
});

test('reports validation failures and settles the request', async (t) => {
	const error = new Error('Source read failed');
	const { queue, handlers } = createQueue(t, {
		validate: async () => {
			throw error;
		},
	});
	const task = createTask('unreadable');
	await queue.push(task, 1);
	assert.equal(handlers.prepare.mock.callCount(), 0);
	assert.deepEqual(handlers.showError.mock.calls[0].arguments, [task, error]);
});

test('rebuilding cancels waiting jobs while preserving the active compilation', async (t) => {
	const started = deferred();
	const compiled = deferred();
	const active = createTask('active');
	const { queue, handlers } = createQueue(t, {
		prepare: t.mock.fn((task) => {
			if (task === active) {
				started.resolve();
				return compiled.promise;
			}
			return '<svg/>';
		}),
	});
	const activeCompletion = queue.push(active, 1);
	await started.promise;
	const cancelledCompletion = queue.push(createTask('cancelled'), 1);
	queue.rebuild();
	await cancelledCompletion;
	const nextCompletion = queue.push(createTask('next'), 1);
	assert.equal(handlers.prepare.mock.callCount(), 1);
	compiled.resolve('<svg/>');
	await Promise.all([activeCompletion, nextCompletion]);
	assert.deepEqual(
		handlers.prepare.mock.calls.map((call) => call.arguments[0].getStem()),
		['active', 'next'],
	);
});

test('disposing settles all requests and prevents later display', async (t) => {
	const started = deferred();
	const compiled = deferred();
	const { queue, handlers } = createQueue(t, {
		prepare: () => {
			started.resolve();
			return compiled.promise;
		},
	});
	const active = createTask('active');
	const activeCompletion = queue.push(active, 1);
	await started.promise;
	const waiting = createTask('waiting');
	const waitingCompletion = queue.push(waiting, 1);
	queue.dispose();
	await Promise.all([activeCompletion, waitingCompletion, queue.push(createTask('ignored'), 1)]);
	compiled.resolve('<svg/>');
	await setImmediate();
	assert.equal(handlers.render.mock.callCount(), 0);
	assert.deepEqual(active.el.children, []);
	assert.deepEqual(waiting.el.children, []);
	assert.equal(queue.idle(), true);
});
