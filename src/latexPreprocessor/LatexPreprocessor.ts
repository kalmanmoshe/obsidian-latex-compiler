import { App, Notice } from "obsidian";
import { LatexSourceType } from "src/latexRender/latexDependency";
import { LatexSourceProcessor } from "src/latexPreprocessor/latexSourceProcessor";
import { VirtualFileSystem } from "src/latexPreprocessor/virtualFileSystem";
import LatexCompilerPlugin from "src/main";
import { getAutoUseFilePaths } from "src/obsidian/fileWatch";

export interface LatexPreprocessor {
    process(
        content: string,
        sourcePath: string,
        sourceType: LatexSourceType,
    ): Promise<string>;

    refresh(
        becauseFileLocationUpdated?: boolean,
        becauseFileUpdated?: boolean,
    ): void;
}

export class BasicLatexPreprocessor implements LatexPreprocessor {
    async process(content: string, _: string, sourceType: LatexSourceType): Promise<string> {
        if (sourceType !== LatexSourceType.TikzCodeBlock) return content;

        content = content.replaceAll('&nbsp;', '');
        let lines = content.split("\n");
        // Trim whitespace that is inserted when pasting in code, otherwise TikZJax complains 
        lines = lines.map(line => line.trim());
        // Remove empty lines 
        content = lines.filter(line => line).join("\n");

        if (content.match('\\\\begin *{document}') === null) {
            content = '\\begin{document}\n' + content + '\n\\end{document}\n';
        }
        return content;
    }

    refresh(_: boolean = false, __: boolean = false): void { }
}

export class SmartLatexPreprocessor implements LatexPreprocessor {
    private processor: LatexSourceProcessor;
    constructor(
        private plugin: LatexCompilerPlugin,
        private vfs: VirtualFileSystem,
        private app: App
    ) {
        this.processor = new LatexSourceProcessor(this.vfs, this.app);
    }

    async process(content: string, sourcePath: string, sourceType: LatexSourceType): Promise<string> {

        const result = await this.processor.parseFile(
            content,
            sourcePath,
            sourceType,
        );

        return result.content;
    }

    refresh(
        becauseFileLocationUpdated = false,
        becauseFileUpdated = false,
    ) {
        if (!this.plugin.settings.experimentalSmartPreprocessing) return;

        const autoUsePaths = getAutoUseFilePaths(
            this.plugin.app.vault,
            this.plugin.settings.autoloadedVfsFilesDir,
        );

        this.vfs.setAutoUseFilePaths(autoUsePaths);

        this.showPreambleLoadedNotice(
            autoUsePaths.size,
            becauseFileLocationUpdated,
            becauseFileUpdated,
        );
    }

    private showPreambleLoadedNotice(
        nExplicitPreambleFiles: number,
        becauseFileLocationUpdated: boolean,
        becauseFileUpdated: boolean,
    ) {
        if (!(becauseFileLocationUpdated || becauseFileUpdated)) return;

        const prefix = becauseFileLocationUpdated
            ? 'Loaded '
            : 'Successfully reloaded ';

        new Notice(
            `${prefix}${nExplicitPreambleFiles} preamble files.`,
            5000,
        );
    }
}