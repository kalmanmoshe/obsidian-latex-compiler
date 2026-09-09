export function optimizeSVG(svg: string): string {

	try {
		const { width, height } = extractDimensions(svg);

		let optimized = optimizeSvgSize(svg);

		// Ensure dimensions are preserved
		if (width && height) {
			optimized = setSvgDimensions(
				optimized,
				width,
				height,
			);
		}

		return optimized;
	} catch (e) {
		console.warn('SVGO optimization failed:', e);
		return svg;
	}
}

function extractDimensions(svg: string): { width?: string; height?: string } {
	const headerMatch = svg.match(/<svg[^>]+>/i);
	if (!headerMatch) return {};

	const header = headerMatch[0];

	const widthMatch = header.match(/width="([^"]+)"/i);
	const heightMatch = header.match(/height="([^"]+)"/i);

	return {
		width: widthMatch?.[1],
		height: heightMatch?.[1],
	};
}

function setSvgDimensions(
	svg: string,
	width: string | number,
	height: string | number,
): string {
	return svg.replace(/<svg\b([^>]*)>/i, (_, attributes: string) => {
		const withoutDimensions = attributes
			.replace(/\s+width\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
			.replace(/\s+height\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');

		return `<svg width="${width}" height="${height}"${withoutDimensions}>`;
	});
}

export function optimizeSvgSize(svg: string, precision = 3): string {
	svg = svg
		.replace(/<!DOCTYPE[\s\S]*?>/gi, '')
		.replace(/<\?xml[\s\S]*?\?>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata>/gi, '')
		.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
		.replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/gi, '')
		.replace(/\s+[A-Za-z_:][-A-Za-z0-9_:.]*=(["'])\1/g, '')
		.replace(/>\s+</g, '><');

	svg = svg.replace(
		/\b(d|points|transform|viewBox|x|y|x1|x2|y1|y2|width|height|rx|ry|cx|cy|r)="([^"]*)"/g,
		(_match, name: string, value: string) => {
			return `${name}="${optimizeNumericAttribute(
				value,
				precision,
			)}"`;
		},
	);

	return svg.trim();
}

function optimizeNumericAttribute(
	value: string,
	precision: number,
): string {
	value = value.replace(
		/-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi,
		(raw) => optimizeNumber(raw, precision),
	);

	value = value
		.replace(/\s+/g, ' ')
		.replace(/\s*,\s*/g, ',')
		.trim();

	return value;
}

function optimizeNumber(raw: string, precision: number): string {
	const n = Number(raw);

	if (!Number.isFinite(n)) return raw;
	if (n === 0) return '0';

	const abs = Math.abs(n);

	let decimalPlaces = precision;

	// Preserve precision for very small values.
	// .000012345 -> .0000123 rather than 0
	if (abs < 1) {
		const firstNonZeroPlace =
			Math.floor(-Math.log10(abs));

		decimalPlaces = firstNonZeroPlace + precision;
	}

	let result = n.toFixed(decimalPlaces);

	if (result.includes('.')) {
		result = result
			.replace(/0+$/, '')
			.replace(/\.$/, '');
	}

	result = result.replace(/^(-?)0\./, '$1.');

	return result;
}