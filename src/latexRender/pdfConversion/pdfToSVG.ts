import LatexCompilerPlugin from 'src/main';
import PdfToSvgWasm from '@pdf-to-svg-runtime';
import { LatexRenderChild } from '../task/latexRenderChild';
import { CompilePipeline } from 'src/settings/settings';
import { optimizeSVG } from './optimizeSVG';

export const LATEX_RENDER_ID_KEY = 'data-id';

export async function pdfToSVG(pdfData: Uint8Array): Promise<string> {
    const module = await PdfToSvgWasm();

    module.FS.writeFile('/input.pdf', pdfData);

    const status = module._convertPdfToSvg();

    if (status !== 0) {
        throw new Error(`PDF to SVG failed with status ${status}`);
    }

    try {
        return module.FS.readFile('/input.svg', {
            encoding: 'utf8',
        });
    } finally {
        try {
            module.FS.unlink('/input.pdf');
        } catch {
            // File might not have been created.
        }

        try {
            module.FS.unlink('/input.svg');
        } catch {
            // Conversion might not have produced it.
        }
    }
}

export async function pdfToOptimizedSVG(
    pdfData: Uint8Array,
    config: {
        invertColorsInDarkMode: boolean;
        stem: string;
    },
) {
    let svg = await pdfToSVG(pdfData);

    svg = prefixSvgIds(svg, config.stem);

    svg = optimizeSVG(svg);

    if (config.invertColorsInDarkMode) {
        svg = colorSVGinDarkMode(svg);
    }

    return setSvgDataId(svg, config.stem);
}

function prefixSvgIds(svgString: string, prefix: string): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(svgString, 'image/svg+xml');
	const svg = doc.documentElement;

	if (svg.tagName.toLowerCase() !== 'svg') {
		return svgString;
	}

    const idMap = new Map<string, string>();

    // Rename every ID.
    for (const element of Array.from(svg.querySelectorAll('[id]'))) {
        const oldId = element.getAttribute('id');
        if (!oldId) continue;

        const newId = `${prefix}__${oldId}`;
        idMap.set(oldId, newId);
        element.setAttribute('id', newId);
    }

    // Rewrite references to those IDs.
    for (const element of Array.from(svg.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
            let value = attribute.value;

            for (const [oldId, newId] of idMap) {
                // href="#foo" / xlink:href="#foo"
                if (value === `#${oldId}`) {
                    value = `#${newId}`;
                }

                // clip-path="url(#foo)", fill="url(#foo)", etc.
                value = value.replaceAll(
                    `url(#${oldId})`,
                    `url(#${newId})`,
                );
            }

            if (value !== attribute.value) {
                element.setAttribute(attribute.name, value);
            }
        }
    }

	return new XMLSerializer().serializeToString(svg);
}

function colorSVGinDarkMode(svg: string) {
    // Replace the color "black" with currentColor (the current text color)
    // so that diagram axes, etc are visible in dark mode
    // and replace "white" with the background color
    if (activeDocument.body.classList.contains('theme-dark')) {
        svg = svg
            .replace(/rgb\(0%, 0%, 0%\)/g, 'currentColor')
            .replace(/rgb\(100%, 100%, 100%\)/g, 'var(--background-primary)');
    } else {
        svg = svg
            .replace(/rgb\(100%, 100%, 100%\)/g, 'currentColor')
            .replace(/rgb\(0%, 0%, 0%\)/g, 'var(--background-primary)');
    }

    return svg;
}

function setSvgDataId(svg: string, id: string): string {
    const escapedId = id
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return svg.replace(
        /<svg\b([^>]*)>/i,
        (_, attributes: string) => {
            if (/\bdata-id\s*=/.test(attributes)) {
                return `<svg${attributes.replace(
                    /\bdata-id\s*=\s*(?:"[^"]*"|'[^']*')/i,
                    `${LATEX_RENDER_ID_KEY}="${escapedId}"`,
                )}>`;
            }

            return `<svg ${LATEX_RENDER_ID_KEY}="${escapedId}"${attributes}>`;
        },
    );
}

// Obsidian dose not allow directly inserting SVG into the DOM, so we need to parse it and insert it as a node.
export function insertSvg(
    svgString: string, 
    renderChild: LatexRenderChild, 
    filePath: string, 
    compilePipeline: CompilePipeline,
    plugin: LatexCompilerPlugin
): void {
    const ownerDocument = renderChild.containerEl.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;

    if (!ownerWindow) {
        throw new Error('Element is not attached to a window.');
    }

    const parsedDocument = new ownerWindow.DOMParser().parseFromString(
        svgString,
        'image/svg+xml',
    );

    const svg = parsedDocument.documentElement;

    if (svg.tagName.toLowerCase() !== 'svg') {
        throw new Error('Generated output is not a valid SVG.');
    }

    if (!svg.hasAttribute(LATEX_RENDER_ID_KEY)) {
        throw new Error(
            `SVG element is missing the required ${LATEX_RENDER_ID_KEY} attribute.`,
        );
    }

    renderChild.containerEl.replaceChildren(ownerDocument.adoptNode(svg));
    plugin.menuDecider.add(renderChild, filePath, compilePipeline)
}
