export class FakeWorker {
	onmessage = null;
	onerror = null;
	messages = [];
	terminated = false;

	postMessage(message) {
		this.messages.push(message);
	}

	emit(message) {
		this.onmessage?.({ data: message });
	}

	terminate() {
		this.terminated = true;
	}
}

export class TestElement {
	children = [];
	parent = null;
	textContent = '';

	constructor(cls = '') {
		this.cls = cls;
	}

	createDiv({ cls, text = '' }) {
		const child = new TestElement(cls);
		child.textContent = text;
		this.appendChild(child);
		return child;
	}

	appendChild(child) {
		child.remove();
		child.parent = this;
		this.children.push(child);
	}

	remove() {
		if (this.parent)
			this.parent.children = this.parent.children.filter((child) => child !== this);
		this.parent = null;
	}

	querySelector(selector) {
		for (const child of this.children) {
			if (`.${child.cls}` === selector) return child;
			const match = child.querySelector(selector);
			if (match) return match;
		}
		return null;
	}
}

export function createTask(stem, overrides = {}) {
	return {
		el: new TestElement(),
		resultFormat: 'svg',
		valid: true,
		getStem: () => stem,
		isStillValid() {
			return this.valid;
		},
		...overrides,
	};
}

export function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((accept, fail) => {
		resolve = accept;
		reject = fail;
	});
	return { promise, resolve, reject };
}
