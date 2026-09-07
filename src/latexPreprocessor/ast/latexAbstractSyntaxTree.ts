import { String, Macro, Argument, Node, DependencyMacro } from './typs/astNodes';
import { parse } from './autoParse/ast-types-pre';
import { verifyEnvironmentWrap } from './verifyEnvironmentWrap';

//I need to Stop using the AST for inputs and only add and remove inputs through the dependencies.
export class LatexAbstractSyntaxTree {
	protected content: Node[];

	constructor(content: Node[]) {
		this.content = content;
	}

	static parse(latex: string) {
		const content = parse(latex).content;
		return new LatexAbstractSyntaxTree(content);
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
		const index = this.getAddInputFileIndex(true);

		this.spliceContent(index, 0, ...macros);
	}

	private getAddInputFileIndex(isAutoUseFile = false) {
		//i want it to go after the documentclass and after the auto use files
		//the start index is
		const startIndex = this.content.findIndex((node) => {
			if (!node.isMacro()) return true;
			if (node.content === 'documentclass') return false;
			if (node instanceof DependencyMacro) {
				// If the file is auto use, then we want the index to be after only the auto use files.
				return isAutoUseFile ? !node.autoUse : false;
			}
			// important: normal macro like pgfplotsset
			// should be the insertion point
			return true;
		});
		return startIndex === -1 ? 0 : startIndex;
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
		const newAst = parse(latex);
		this.replaceContent(newAst.content);
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
