import { App, Modal } from 'obsidian';
import { File } from './latexLogParser';
import { CachedLogInfo } from '../cache/logCache';
import { ErrorLevel, errorMessageDiv } from '../errors/errorDisplay';
import { pluginErrorToErrorMessage } from '../errors/pluginErrors';
import { logEntryToErrorMessage } from './humanReadableLogs';

type LogTab = {
	name: string;
	render: (container: HTMLElement) => void;
};

export class LogDisplayModal extends Modal {
	logInfo: CachedLogInfo;

	constructor(logInfo: CachedLogInfo, app: App) {
		super(app);
		this.logInfo = logInfo;
		this.modalEl.addClass('latex-compiler-log-modal');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'LaTeX log' });

		const tabs: LogTab[] = [];
		const { log, userFacingErrors } = this.logInfo;

		if (log.all.length > 0 || userFacingErrors.length > 0) {
			tabs.push({
				name: 'Errors',
				render: (container) => this.renderErrors(container),
			});
		}

		if (log.raw?.trim()) {
			tabs.push({
				name: 'Raw',
				render: (container) => this.renderRaw(container),
			});
		}

		if (log.files.length > 0) {
			tabs.push({
				name: 'Dependencies',
				render: (container) => this.renderFiles(container),
			});
		}

		const tabsContainer = contentEl.createDiv('latex-compiler-log-tabs');
		const buttonsContainer = tabsContainer.createDiv('latex-compiler-log-buttons');
		const sectionsContainer = tabsContainer.createDiv('latex-compiler-log-sections');
		const contentSections = new Map<string, HTMLElement>();

		tabs.forEach(({ name, render }) => {
			const button = buttonsContainer.createEl('button', {
				text: name,
				cls: 'latex-compiler-log-tab-button',
			});
			const section = sectionsContainer.createDiv('latex-compiler-log-tab-content');
			section.addClass('is-hidden');

			contentSections.set(name, section);

			button.addEventListener('click', () => {
				for (const currentSection of contentSections.values()) {
					currentSection.addClass('is-hidden');
				}

				for (const child of Array.from(buttonsContainer.children)) {
					if (child.instanceOf(HTMLElement)) {
						child.removeClass('active');
					}
				}

				section.removeClass('is-hidden');
				button.addClass('active');
			});

			render(section);
		});

		(buttonsContainer.firstChild as HTMLElement)?.click();
		contentEl.appendChild(tabsContainer);
	}

	private renderErrors(container: HTMLElement) {
		for (const error of this.logInfo.userFacingErrors) {
			container.appendChild(errorMessageDiv(pluginErrorToErrorMessage(error)));
		}
		const severityOrder = {
			[ErrorLevel.Error]: 0,
			[ErrorLevel.Warning]: 1,
			[ErrorLevel.Typesetting]: 2,
			[ErrorLevel.Info]: 3,
		};

		const logEntries = [...this.logInfo.log.all]
			.sort(
				(a, b) =>
					severityOrder[a.level] -
					severityOrder[b.level],
			);

		for (const entry of logEntries) {
			container.appendChild(
				errorMessageDiv(
					logEntryToErrorMessage(entry),
					entry.level,
				),
			);
		}
	}

	private renderFiles(container: HTMLElement) {
		const files = this.logInfo.log.files;

		const countNestedLoads = (file: File): number => {
			if (!file.files?.length) return 0;

			return file.files.reduce(
				(total, child) => total + 1 + countNestedLoads(child),
				0,
			);
		};

		const collectUniqueFiles = (
			file: File,
			paths: Set<string>,
		) => {
			paths.add(file.path);

			file.files?.forEach((child) => {
				collectUniqueFiles(child, paths);
			});
		};

		const uniqueFiles = new Set<string>();

		files.forEach((file) => {
			collectUniqueFiles(file, uniqueFiles);
		});

		const uniqueFileCount = uniqueFiles.size;

		const header = container.createDiv({
			cls: 'latex-compiler-dependencies-header',
		});

		header.createSpan({
			text: `${uniqueFileCount} unique ${
				uniqueFileCount === 1 ? 'file' : 'files'
			} loaded during compilation`,
			cls: 'latex-compiler-dependencies-description',
		});

		const tree = container.createDiv({
			cls: 'latex-compiler-dependencies',
		});

		const renderTree = (
			file: File,
			parent: HTMLElement,
			depth = 0,
		) => {
			const wrapper = parent.createDiv({
				cls: `latex-compiler-dependency depth-${depth}`,
			});

			const hasChildren = !!file.files?.length;

			if (hasChildren) {
				const details = wrapper.createEl('details', {
					cls: 'latex-compiler-dependency-details',
				});

				details.open = depth === 0;

				const summary = details.createEl('summary', {
					cls: 'latex-compiler-dependency-summary',
				});

				summary.createSpan({
					text: this.displayPath(file.path),
					cls: 'latex-compiler-dependency-path',
				});

				const nestedLoadCount = countNestedLoads(file);

				summary.createSpan({
					text: `${nestedLoadCount} ${
						nestedLoadCount === 1
							? 'nested load'
							: 'nested loads'
					}`,
					cls: 'latex-compiler-dependency-count',
				});

				const children = details.createDiv({
					cls: 'latex-compiler-dependency-children',
				});

				file.files.forEach((child) => {
					renderTree(child, children, depth + 1);
				});
			} else {
				const line = wrapper.createDiv({
					cls: 'latex-compiler-dependency-line',
				});

				line.createSpan({
					text: this.displayPath(file.path),
					cls: 'latex-compiler-dependency-path',
				});
			}
		};

		files.forEach((file) => {
			renderTree(file, tree);
		});
	}

	private displayPath(path: string): string {
		let normalized = this.normalizeWorkerPath(path);

		return this.logInfo.virtualToSource?.get(normalized) ?? normalized;
	}

	private normalizeWorkerPath(path: string): string {
		if (path.startsWith('/work/')) {
			return path.slice('/work/'.length);
		}

		if (path.startsWith('/tex/')) {
			return path.slice('/tex/'.length);
		}

		return path;
	}

	private renderRaw(container: HTMLElement) {
		const wrapper = container.createDiv();

		const scrollContainer = wrapper.createDiv(
			'latex-compiler-log-raw-scroll',
		);

		scrollContainer.createEl('pre', {
			text: this.logInfo.log.raw,
			cls: 'latex-compiler-log-raw-content',
		});

		const copyButton = wrapper.createEl('button', {
			text: 'Copy',
			cls: 'latex-compiler-log-copy-button',
		});

		copyButton.addEventListener('click', () => {
			navigator.clipboard
				.writeText(this.logInfo.log.raw)
				.then(() => {
					copyButton.textContent = 'Copied!';
					window.setTimeout(() => (copyButton.textContent = 'Copy'), 1500);
				})
				.catch(() => {
					copyButton.textContent = 'Failed';
					window.setTimeout(() => (copyButton.textContent = 'Copy'), 1500);
				});
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
