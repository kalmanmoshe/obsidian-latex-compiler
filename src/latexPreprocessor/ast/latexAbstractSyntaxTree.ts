import { String, Macro, Argument, Node, DependencyMacro } from './typs/astNodes';
import { parse } from './latexParser';
import { verifyEnvironmentWrap } from './verifyEnvironmentWrap';

export class LatexAbstractSyntaxTree {
	protected content: Node[];

	constructor(content: Node[]) {
		this.content = content;
	}

	static parse(latex: string) {
		const { root, inputReferences } = parse(latex);
		return { ast: new LatexAbstractSyntaxTree(root.content), inputReferences };
	}

	verifyProperDocumentStructure() {
		const environmentVerified = verifyEnvironmentWrap(this);
		if (environmentVerified) this.replaceContent(environmentVerified);
		this.verifyDocumentclass();
	}

	hasDocumentclass() {
		return this.content.some(
			(node) => node instanceof Macro && node.content === 'documentclass',
		);
	}

	verifyDocumentclass() {
		//TODO: i need to look also in the dependencies
		const documentclass = this.content.find(
			(node) => node instanceof Macro && node.content === 'documentclass',
		); /*[this,...Array.from(this.dependencies.values()).map(dep=>dep.ast)]
        .find(ast=> ast?.content.find(node=>node instanceof Macro&&node.content==="documentclass"))*/
		if (!documentclass) {
			this.content.unshift(
				new Macro('documentclass', undefined, [
					new Argument('[', ']', [new String('tikz,border=2mm')]),
					new Argument('{', '}', [new String('standalone')]),
				]),
			);
		}
	}

	find(
		predicate: (node: Node) => boolean,
	): { tree: LatexAbstractSyntaxTree; node: Node } | undefined {
		const node = this.content.find(predicate);
		if (node) {
			return { tree: this, node };
		}
	}

	toString() {
		return this.content.map((node) => node.toString()).join('');
	}

	addAutoUseDependenciesToPreamble(depPaths: string[]) {
		if (depPaths.length === 0) return;
		const macros: Macro[] = [];
		
		for (const depPath of depPaths) {
			const texPath = depPath.startsWith('/') ? depPath : '/' + depPath;
			macros.push(
				new DependencyMacro('input', true, undefined, [
					new Argument('{', '}', [new String(texPath)]),
				]),
			);
		}
		const index = this.getAddInputFileIndex();

		this.spliceContent(index, 0, ...macros);
	}

	private getAddInputFileIndex() {
		let index = this.content.findIndex(
			(node) => node.isMacro() && node.content === 'documentclass',
		) + 1;
		let node = this.content[index];
		while (node instanceof DependencyMacro && node.autoUse) {
			node = this.content[++index];
		}
		return index;
	}

	replaceContent(nodes: Node[]) {
		this.content = nodes;
	}

	spliceContent(index: number, deleteCount: number, ...nodes: Node[]) {
		return this.content.splice(index, deleteCount, ...nodes);
	}

	getClonedContent() {
		return this.content.map((node) => node.clone());
	}

	/** Internal use only. Mutates AST directly. */
	_getMutableContent(): Node[] {
		return this.content;
	}

	clone(): this {
		return new LatexAbstractSyntaxTree(this.content.map((node) => node.clone())) as this;
	}

	reParse() {
		const latex = this.toString();
		const { root } = parse(latex);
		this.replaceContent(root.content);
	}
}

const texSourceExtensions = [
	'tex',
	'latex',
	'sty',
	'cls',
];

export function isTexSourceExtension(extension: string): boolean {
	return texSourceExtensions.includes(extension.toLowerCase());
}
