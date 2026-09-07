import { Macro, Environment, Argument, Node, DependencyMacro } from './typs/astNodes';
import { LatexAbstractSyntaxTree } from './latexAbstractSyntaxTree';
import { Notice } from 'obsidian';

const preambleMacros = [
	'documentclass',
	'usepackage',
	'usetikzlibrary',
	'bibliography',
	'pgfplotsset', //inclode pgfplots must go before
];

//TODO: make this usable
/**
 *
 * @param ast
 * @returns undefined if no changes were made, otherwise the new content array with the document environment wrap.
 */
export function verifyEnvironmentWrap(ast: LatexAbstractSyntaxTree): Node[] | undefined {
	const content = ast.getClonedContent();
	const envs = getEnvironments(content);
	if (envs.some((env) => env.env === 'document')) return content;
	const args = findEnvironmentArgs(content) || [];

	//if no envs
	// if (envs.length === 0) {
	// 	console.log(
	// 		'No environments found, creating document environment wrap around entire content',
	// 		{
	// 			content,
	// 			envs,
	// 			args
	// 		}
	// 	);
	// 	return createDocEnvironment(content, envs, -1, args);
	// }

	const preambleEndIndex = content.findIndex((node) => {
		if (node.isWhitespaceLike()) return false;

		if (node instanceof Macro) {
			if (preambleMacros.includes(node.content)) return false;
			if (node instanceof DependencyMacro && node.autoUse) return false;
		}

		return true; // first real content
	});

	if (preambleEndIndex === -1) {
		return undefined;
	}

	const doc = createDocEnvironment(content, envs, preambleEndIndex, args);
	return doc;
}

function getEnvironments(nodes: Node[]): Environment[] {
	const envs: Environment[] = [];
	for (const node of nodes) {
		if (node instanceof Environment) {
			envs.push(node);
		} else if (node.hasChildren()) {
			envs.push(...getEnvironments(node.getNodeChildren()));
		}
	}
	return envs;
}

function createDocEnvironment(
	content: Node[],
	envNodes: Environment[],
	preambleEndIndex: number,
	args: Argument[],
): Node[] {
	const index = preambleEndIndex === -1 ? content.length : preambleEndIndex;
	const preamble = content.slice(0, index);
	const envContent = content.slice(index);
	const sortedEnvs = getEnvironmentStructure(envNodes).filter((env) => !env.inAst);
	let envs = new Environment('environment', 'dummy', []);
	const diff = args.length - sortedEnvs.length;
	if (diff > 0) {
		new Notice('Too many arguments for environments, the last ' + diff + ' will be ignored.');
		args.splice(-diff);
	}
	let current = envs;
	while (sortedEnvs.length > 0) {
		const env = sortedEnvs.shift();
		if (!env) break;
		let arg: [Argument] | undefined = undefined;
		// Check if the environment has arguments
		if (args && args.length === sortedEnvs.length + 1) {
			const poppedArg = args.shift();
			arg = poppedArg ? [poppedArg] : undefined;
		}
		const newEnv = new Environment('environment', env.value, [], arg);
		current.content.push(newEnv);
		current = newEnv;
	}
	current.content.push(...envContent);
	envs = envs.content[0] as Environment;
	const doc = [...preamble, envs];
	return doc;
}

export function findEnvironmentArgs(content: Node[]): Argument[] | undefined {
	const firstBracketIndex = content.findIndex(
		(node) => node.isString?.() && node.content === '[',
	);

	const controlIndexes = [
		content.findIndex((node) => node instanceof DependencyMacro && node.autoUse),
		content.findIndex((node) => node instanceof Environment),
		firstBracketIndex,
	].filter((i) => i !== -1);

	const isArgListLikely =
		firstBracketIndex !== -1 &&
		controlIndexes.length > 0 &&
		firstBracketIndex === Math.min(...controlIndexes);

	if (!isArgListLikely) return undefined;

	const args: Argument[] = [];
	let openIndex = firstBracketIndex;

	while (openIndex !== -1) {
		const closeIndex = findMatchingBracket(content, openIndex);
		if (closeIndex === -1) break;

		const rawNodes = content.splice(openIndex, 1 + closeIndex - openIndex);

		rawNodes.shift(); // Remove "["
		rawNodes.pop(); // Remove "]"
		// Trim leading/trailing whitespace
		while (rawNodes[0]?.isWhitespaceLike?.()) rawNodes.shift();
		while (rawNodes[rawNodes.length - 1]?.isWhitespaceLike?.()) rawNodes.pop();
		args.push(new Argument('[', ']', rawNodes));
		openIndex = content.findIndex((node) => node.isString?.() && node.content === '[');
		const range = content.slice(firstBracketIndex, openIndex);
		if (openIndex !== -1 && !range.every((n) => n.isWhitespaceLike?.())) break;
	}

	return args;
}

function getEnvironmentStructure(envNodes: Environment[]) {
	const envs = envNodes.map((env) => env.env);
	const sortedEnvs: {
		parent: string | null;
		value: string;
		inAst: boolean;
	}[] = [];
	for (const env of envs) {
		let parent = envDepthStructure[env];
		if (parent === undefined) {
			console.warn(`Environment ${env} not found in envDepthStructure, assuming root level`);
		}
		parent = !parent && env != 'document' ? 'document' : parent || null;

		sortedEnvs.push({ parent, value: env, inAst: true });
	}
	if (sortedEnvs.length === 0) {
		sortedEnvs.push({
			parent: 'document',
			value: 'tikzpicture',
			inAst: false,
		}); // Default environment if none found
	}
	let unknownEnv: string | null = null;
	do {
		unknownEnv =
			sortedEnvs.find(
				(env) => env.parent !== null && !sortedEnvs.some((e) => e.value === env.parent),
			)?.parent || null;
		if (unknownEnv) {
			const parentEnv = envDepthStructure[unknownEnv] || null;
			if (parentEnv === undefined) {
				console.warn(
					`Environment ${unknownEnv} not found in envDepthStructure, assuming root level`,
				);
			}
			sortedEnvs.push({
				parent: parentEnv,
				value: unknownEnv,
				inAst: false,
			});
		}
	} while (unknownEnv !== null);
	sortedEnvs.sort((a, b) => {
		if (a.parent === null && b.parent !== null) return -1;
		if (a.parent !== null && b.parent === null) return 1;
		if (a.parent === b.parent) return 0;
		return a.value.localeCompare(b.value);
	});
	return sortedEnvs;
}

const bracketPairs = {
	'(': ')',
	')': '(',
	'[': ']',
	']': '[',
	'{': '}',
	'}': '{',
};

function findMatchingBracket(content: Node[], index: number) {
	if (!content[index].isString() || !(content[index].content in bracketPairs))
		throw new Error('Not a bracket');
	const bracket = content[index].content;
	const bracketPair = bracketPairs[bracket as keyof typeof bracketPairs];
	let count = 0;
	for (let i = index; i < content.length; i++) {
		const node = content[i];
		if (!node.isString()) continue;
		if (node.content === bracket) count++;
		if (node.content === bracketPair) count--;
		if (count === 0) return i;
	}
	throw new Error('No matching bracket found');
}

/**
 * Maps LaTeX environment names to their required parent environments.
 * Null if root level.
 */
const envDepthStructure: Record<string, null | string> = {
	document: null,
	tikzpicture: 'document',
	axis: 'tikzpicture',
	scope: 'tikzpicture',
};
