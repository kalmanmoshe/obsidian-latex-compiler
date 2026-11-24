import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { loadModule } from '../support/load-module.mjs';
import { FakeWorker, deferred } from '../support/fakes.mjs';

const { default: LatexEngine, EngineStatus } = await loadModule(
	'src/latexRender/compiler/base/compilerBase/engine.ts',
);

globalThis.window = globalThis;
after(() => {
	delete globalThis.window;
});

async function createEngine(t) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const worker = new FakeWorker();
	const engine = new LatexEngine(async () => worker, 'test');
	const loading = engine.loadEngine();
	await Promise.resolve();
	worker.emit({ result: 'ok', cmd: 'ready' });
	await loading;
	t.after(() => engine.closeWorker());
	return { engine, worker };
}

test('initializes the worker and rejects overlapping commands', async (t) => {
	const { engine, worker } = await createEngine(t);
	assert.equal(engine.isReady(), true);
	const task = engine.task({ cmd: 'writefile', url: 'main.tex', src: 'Source' });
	assert.equal(engine.getEngineStatus(), EngineStatus.Busy);
	assert.throws(() => engine.task({ cmd: 'compilelatex' }), /Engine is not ready/);
	assert.deepEqual(worker.messages[0], { cmd: 'writefile', url: 'main.tex', src: 'Source' });
	worker.emit({ cmd: 'writefile', result: 'ok' });
	await task;
	assert.equal(engine.isReady(), true);
});

test('returns compile output and removes completed task handlers', async (t) => {
	const { engine, worker } = await createEngine(t);
	const result = engine.compileLaTeX();
	worker.emit({
		cmd: 'compilelatex',
		result: 'ok',
		status: 0,
		pdf: new Uint8Array([37, 80, 68, 70]),
		log: 'Compiled',
	});
	const compiled = await result;
	assert.equal(compiled.isStatus(0), true);
	assert.equal(compiled.log, 'Compiled');
	assert.deepEqual(compiled.pdf, new Uint8Array([37, 80, 68, 70]));
	assert.equal(worker.onmessage, null);
	assert.equal(worker.onerror, null);
	t.mock.timers.tick(20000);
	assert.equal(engine.isReady(), true);
});

test('ignores unrelated messages and handles intermediate dependency requests', async (t) => {
	const { engine, worker } = await createEngine(t);
	const handled = deferred();
	const intermediate = t.mock.fn(async (message) => {
		if (message.cmd !== 'resolvefile') return false;
		handled.resolve();
		return true;
	});
	const task = engine.task({ cmd: 'compilelatex' }, intermediate);
	worker.emit({ cmd: 'unrelated' });
	worker.emit({ cmd: 'resolvefile', requestId: 1 });
	await handled.promise;
	assert.equal(engine.isReady(), false);
	worker.emit({ cmd: 'compilelatex', result: 'ok', status: 0 });
	assert.deepEqual(await task, { status: 0 });
});

test('times out unresponsive workers and terminates them on close', async (t) => {
	const { engine, worker } = await createEngine(t);
	const task = engine.task({ cmd: 'compilelatex' }, undefined, 100);
	const rejected = assert.rejects(task, /Engine timeout on cmd=compilelatex after 100ms/);
	t.mock.timers.tick(100);
	await rejected;
	assert.equal(engine.getEngineStatus(), EngineStatus.Unresponsive);
	engine.closeWorker();
	assert.equal(worker.terminated, true);
	assert.equal(engine.getEngineStatus(), EngineStatus.Init);
});

test('pauses the command timeout during downloads and resumes it afterward', async (t) => {
	const { engine, worker } = await createEngine(t);
	const task = engine.task({ cmd: 'compilelatex' }, undefined, 100);
	const rejected = assert.rejects(task, /Engine timeout/);
	t.mock.timers.tick(50);
	worker.emit({ cmd: 'download-started' });
	t.mock.timers.tick(1000);
	assert.equal(engine.getEngineStatus(), EngineStatus.Busy);
	worker.emit({ cmd: 'download-finished' });
	t.mock.timers.tick(99);
	assert.equal(engine.getEngineStatus(), EngineStatus.Busy);
	t.mock.timers.tick(1);
	await rejected;
});

for (const cmd of ['workererror', 'workerrejection']) {
	test(`cleans up the command timer after ${cmd}`, async (t) => {
		const { engine, worker } = await createEngine(t);
		const clearTimeout = t.mock.method(globalThis, 'clearTimeout');
		const task = engine.task({ cmd: 'compilelatex' });
		const rejected = assert.rejects(task, /worker error/);
		const clearsBeforeError = clearTimeout.mock.callCount();
		worker.emit({ cmd, message: 'Worker crashed' });
		await rejected;
		assert.equal(engine.getEngineStatus(), EngineStatus.Failed);
		assert.ok(clearTimeout.mock.callCount() > clearsBeforeError);
		assert.equal(worker.onmessage, null);
		assert.equal(worker.onerror, null);
	});
}

test('rejects an active command immediately when its worker is closed', async (t) => {
	const { engine, worker } = await createEngine(t);
	const task = engine.task({ cmd: 'compilelatex' });
	const rejected = assert.rejects(task, /closed/);
	engine.closeWorker();
	await rejected;
	assert.equal(worker.terminated, true);
	assert.equal(worker.onmessage, null);
	assert.equal(engine.getEngineStatus(), EngineStatus.Init);
});

test('cleans up when posting a command throws', async (t) => {
	const { engine, worker } = await createEngine(t);
	worker.postMessage = () => {
		throw new Error('Transfer failed');
	};
	await assert.rejects(engine.task({ cmd: 'writefile' }), /Transfer failed/);
	assert.equal(engine.getEngineStatus(), EngineStatus.Failed);
	assert.equal(worker.onmessage, null);
	assert.equal(worker.onerror, null);
	worker.postMessage = () => {};
});

test('does not restore readiness when an intermediate handler finishes after timeout', async (t) => {
	const { engine, worker } = await createEngine(t);
	const intermediate = deferred();
	const task = engine.task({ cmd: 'compilelatex' }, () => intermediate.promise, 100);
	const rejected = assert.rejects(task, /Engine timeout/);
	worker.emit({ cmd: 'compilelatex', status: 0 });
	t.mock.timers.tick(100);
	await rejected;
	intermediate.resolve(false);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(engine.getEngineStatus(), EngineStatus.Unresponsive);
});

test('keeps a worker closed when an intermediate handler rejects later', async (t) => {
	const { engine, worker } = await createEngine(t);
	const intermediate = deferred();
	const task = engine.task({ cmd: 'compilelatex' }, () => intermediate.promise);
	const rejected = assert.rejects(task, /closed/);
	worker.emit({ cmd: 'resolvefile' });
	engine.closeWorker();
	await rejected;
	intermediate.reject(new Error('Late dependency failure'));
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(engine.getEngineStatus(), EngineStatus.Init);
});

test('terminates a worker that fails to initialize', async () => {
	const worker = new FakeWorker();
	const engine = new LatexEngine(async () => worker, 'test');
	const loading = engine.loadEngine();
	const rejected = assert.rejects(loading, /failed to initialize/);
	await Promise.resolve();
	worker.emit({ result: 'failed' });
	await rejected;
	assert.equal(worker.terminated, true);
	assert.equal(engine.getEngineStatus(), EngineStatus.Failed);
});
