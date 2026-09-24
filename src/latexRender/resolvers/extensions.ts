
//the format is realy the kpathsea lookup category  
export function formatToExtension(format: number): string {
    switch (format) {
        case 0: return '.gf';
        case 1: return '.pk';
        case 3: return '.tfm';
        case 4: return '.afm';
        case 5: return '.base';
        case 6: return '.bib';
        case 7: return '.bst';
        case 10: return '.fmt';
        case 11: return '.map';
        case 12: return '.mem';
        case 13: return '.mf';
        case 14: return '.pool';
        case 15: return '.mft';
        case 16: return '.mp';
        case 17: return '.pool';
        case 19: return '.ocp';
        case 20: return '.ofm';
        case 21: return '.opl';
        case 22: return '.otp';
        case 23: return '.ovf';
        case 24: return '.ovp';
        case 25: return '.esp';
        case 26: return '.tex';
        case 28: return '.pool';
        case 29: return '.dtx';
        case 32: return '.pfa';
        case 33: return '.vf';
        case 35: return '.ist';
        case 36: return '.ttf';
        case 37: return '.t42';
        case 43: return '.enc';
        case 44: return 'cmap';
        case 45: return '.sfd';
        case 46: return '.otf';
        case 47: return '.cfg';
        case 48: return '.lig';
        case 51: return '.fea';
        case 52: return '.cid';
        case 53: return '.mlbib';
        case 54: return '.mlbst';
        case 56: return '.ris';
        case 57: return '.bltxml';
        default: return '';
    }
}

export enum CacheFileType {
	Text,
	Binary,
}

export const TEXT_EXTENSIONS = new Set([
    'tex',
    'sty',
    'cls',
    'clo',
    'cfg',
    'def',
    'fd',
    'ldf',
    'bib',
    'bst',
    'map',
    'enc',
    'fea',
    'sfd',
    'lig',
    'txt',
    'md',
    'svg',
]);

export function getFileReadType(
	fileName: string,
): CacheFileType {
	const extension =
		fileName.split('.').pop()?.toLowerCase();

	return extension && TEXT_EXTENSIONS.has(extension)
		? CacheFileType.Text
		: CacheFileType.Binary;
}