type AnyObj = Record<string, unknown>;

type PathStep = { key: string; index?: number };
type PathResult<T extends object> = { node: T; path: PathStep[] } | null;

// Decide if a value is a traversable "node" (includes class instances)
function isTraversableNode(x: unknown): x is object {
	if (x === null || typeof x !== 'object') return false;
	// Skip common non-traversables
	if (x instanceof Date || x instanceof RegExp) return false;
	if (x instanceof Map || x instanceof Set || ArrayBuffer.isView(x)) return false;
	return true; // includes class instances and plain objects
}

/**
 * Generic DFS over objects/class instances:
 * - inspects own enumerable props (Object.keys)
 * - descends into objects and arrays of objects
 * - returns the found node + path from the root
 */
export function findNodeWithPath<T extends object>(
	root: T,
	isTarget: (node: object) => boolean,
	opts?: {
		shouldDescend?: (key: string, value: unknown, parent: object) => boolean;
	},
): PathResult<object> {
	if (!isTraversableNode(root)) return null;

	const path: PathStep[] = [];
	const visited = new Set<object>();
	const shouldDescend = opts?.shouldDescend ?? ((k) => k !== 'parent'); // default: skip parent backref

	function dfs(cur: object): object | null {
		if (visited.has(cur)) return null;
		visited.add(cur);

		if (isTarget(cur)) return cur;

		// Only own, enumerable properties (works for most class fields)
		for (const key of Object.keys(cur)) {
			const val = (cur as AnyObj)[key];
			if (!shouldDescend(key, val, cur)) continue;

			if (Array.isArray(val)) {
				const children = val as unknown[];
				for (let i = 0; i < val.length; i++) {
					const child = children[i];
					if (!isTraversableNode(child)) continue;
					path.push({ key, index: i });
					const found = dfs(child);
					if (found) return found;
					path.pop();
				}
				continue;
			}

			if (isTraversableNode(val)) {
				path.push({ key });
				const found = dfs(val);
				if (found) return found;
				path.pop();
			}
		}
		return null;
	}

	const found = dfs(root);
	return found ? { node: found, path } : null;
}
