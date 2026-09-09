export type StringMap = Record<string, string | number>;

export enum CompilerType {
	PdfTeX = 'PdfTeX',
	XeTeX = 'XeTeX',
}

export enum CompilePipeline {
	Plain = 'plain',
	Process = 'process',
}

/**
 * What to do when the content overflows the container.
 * "Downscale" - downscale the content.
 * "scroll" - add a scrollbar.
 * "hidden" - do nothing, content will overflow.
 */
export enum OverflowStrategy {
	Downscale = 'downscale',
	Scroll = 'scroll',
	Hidden = 'hidden',
}
export type ResultFileFormat = 'svg' | 'pdf';

/**
 * A record of cached dependencies, keyed by their resolved vault path. 
 * The value is the hash of the dependency content at compile time.
 */
export type CachedDependencies = Record<string, string>;

/**
 * Runtime representation of one cached compilation result.
 */
export interface CacheEntry {
	/** The stored output format. */
	format: ResultFileFormat;

	/** Vault file containing the code block that produced this result. */
	sourcePath: string;

	/** Compilation/transformation pipeline used for this code block. */
	pipeline: CompilePipeline;

	/** Dependency state observed during the successful compilation. */
	dependencies: CachedDependencies;
}


export type CacheMap = Map<string, CacheEntry[]>;

/**
 * Raw source hash -> serialized result entries.
 */
export type CacheJson = Record<string, CacheEntry[]>;

export interface PackageCacheData {
	missingPackages: StringMap;
	cachedPackages: StringMap;
	missingFonts: StringMap;
	cachedFonts: StringMap;
}

export interface LatexCompilerPluginSettings {
	virtualFilesFromCodeBlocks: boolean;

	invertColorsInDarkMode: boolean;
	autoRemoveWhitespace: boolean;

	package_url: string;
	physicalCache: boolean;
	physicalCacheLocation: string;
	cache: CacheJson;
	packageCache: Array<StringMap>;
	overflowStrategy: OverflowStrategy;
	compiler: CompilerType;

	/**
	 * Enables the experimental AST-based preprocessing pipeline.
	 *
	 * This may transform LaTeX source more aggressively than the
	 * default TikZJax-compatible preprocessing path.
	 */
	experimentalSmartPreprocessing: boolean;

	autoloadedVfsFilesDir: string;
}

export const DEFAULT_SETTINGS: LatexCompilerPluginSettings = {
	virtualFilesFromCodeBlocks: false,
	// style settings
	invertColorsInDarkMode: true,
	//TODO: put in settings tab
	autoRemoveWhitespace: true,
	//its the public mirror of `https://texlive2.swiftlatex.com/` (which is down and not maintained any more) maintained by Texlyre
	package_url: 'https://texlive.texlyre.org/',
	physicalCache: true,
	physicalCacheLocation: '',
	cache: {},
	packageCache: [{}, {}, {}, {}],
	overflowStrategy: OverflowStrategy.Downscale,
	compiler: CompilerType.PdfTeX,
	
	experimentalSmartPreprocessing: false,

	autoloadedVfsFilesDir: '',
};

export const SOURCE_REVERIFICATION_TIME_MS = 1000;