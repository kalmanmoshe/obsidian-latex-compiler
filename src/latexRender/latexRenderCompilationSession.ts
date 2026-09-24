import { createDependency, LatexDependency } from "src/latexRender/latexDependency";
import { EngineCommands, LatexCompilationSession, WorkerMessage } from "./compiler/base/compilerBase/engine";
import { LatexRenderer } from "./latexRenderer";
import { isTexSourceExtension } from "src/latexPreprocessor/ast/latexAbstractSyntaxTree";
import { resolvePathRelToVault, extractStemAndExtension, resolveDependencyContent, hasExtension } from "./resolvers/paths";
import { hashContent } from "./cache/compilerCache";
import { UserFacingPluginError } from "./errors/pluginErrors";
import { formatToExtension } from "./resolvers/extensions";

export interface ResolvedDependency {
    requestedPath: string;
    requestingPath: string | null;
    format: number;

    virtualPath: string;
    dependency: LatexDependency;
}

export class LatexRenderCompilationSession implements LatexCompilationSession {

    private readonly virtualToSource = new Map<string, string>();
    private readonly sourceToVirtual = new Map<string, string>();

    public readonly resolutions: ResolvedDependency[] = [];

    public readonly userFacingErrors: UserFacingPluginError[] = [];

    constructor(
        private readonly renderer: LatexRenderer,
        sourcePath: string,
    ) {
        this.virtualToSource.set(
            'main.tex',
            sourcePath,
        );
        this.virtualToSource.set(
            'main.aux',
            sourcePath,
        )
    }

    async handleWorkerMessage(
        message: WorkerMessage,
        worker: Worker,
    ): Promise<boolean> {
        if (
            message.cmd !==
            EngineCommands.Resolvefile
        ) {
            return false;
        }

        await this.handleResolveFile(
            message,
            worker,
        );

        return true;
    }

    getResolvedFiles() {
        return this.resolutions.map((res) => ({
            virtualPath: res.virtualPath,
            content: res.dependency.content,
            requestedPath: res.requestedPath,
            requestingPath: res.requestingPath,
            format: res.format,
        }));
    }

    getVirtualPathMappings(): Map<string, string> {
        return new Map(
            this.resolutions.map((resolution) => [
                resolution.virtualPath,
                resolution.dependency.path,
            ]),
        );
    }

    createContentHashRecord() {
        return this.resolutions.reduce((acc, res) => {
            //not sourcePath as the cache needs to resolve the actual content
            acc[res.dependency.path] = hashContent(res.dependency.content);
            return acc;
        }, {} as Record<string, string>);
    }

    private async handleResolveFile(
        message: WorkerMessage,
        worker: Worker,
    ): Promise<void> {
        const requestId = Number(message.requestId);

        const result = await this.resolveFile({
            requestedPath: String(message.requestedPath),
            requestingPath: message.requestingPath
                ? String(message.requestingPath)
                : undefined,
            format: Number(message.format)
        });
        if (!result) {
            worker.postMessage({
                cmd: EngineCommands.Resolvefile,
                requestId,
                found: false,
            });

            return;
        }

        const content = result.content.slice();

        worker.postMessage(
            {
                cmd: EngineCommands.Resolvefile,
                requestId,
                found: true,
                virtualPath: result.virtualPath,
                content,
            },
            [content.buffer],
        );
    }

    private async resolveFile(request: {
        requestedPath: string;
        requestingPath?: string;
        format: number;
    }) {
        const requestingPath = request.requestingPath
            ? this.normalizeVirtualPath(request.requestingPath)
            : undefined;

        if (!requestingPath) {
            return undefined;
        }

        let vaultRequestingPath = this.virtualToSource.get(requestingPath);
        
        if (!vaultRequestingPath) {
            return undefined;
        }

        try {

            let requestedPath = request.requestedPath.replaceAll('\\', '/');
            let basePath = vaultRequestingPath;

            if (requestedPath.startsWith('/')) {
                // "/" means vault root.
                requestedPath = requestedPath.slice(1);
                basePath = '';
            }

            if (!hasExtension(requestedPath)) {
                requestedPath += formatToExtension(request.format);
            }

            const dep = await this.resolveDependency(
                requestedPath,
                basePath,
            );

            const encoder = new TextEncoder();
            const content = typeof dep.content === 'string' ? encoder.encode(dep.content) : new Uint8Array(dep.content);

            const virtualPath = this.getVirtualPath(dep);

            this.resolutions.push({
                requestedPath: request.requestedPath,
                requestingPath,
                format: request.format,
                virtualPath,
                dependency: dep,
            });

            return {
                virtualPath,
                content,
            };
        } catch (error) {
            if (error instanceof UserFacingPluginError && error.relevantToCompilationFailure) {
                this.userFacingErrors.push(error);
            }
            return undefined;
        }
    }

    async resolveDependency(filePath: string, basePath: string): Promise<LatexDependency> {
        const resolvedPath = resolvePathRelToVault(filePath, basePath, this.renderer.plugin.app);
        const { extension } = extractStemAndExtension(resolvedPath);

        const { content, sourceType } = await resolveDependencyContent(resolvedPath, this.renderer.plugin.app);

        return createDependency(content, resolvedPath, sourceType, isTexSourceExtension(extension));
    }

    private getVirtualPath(dep: LatexDependency): string {
        const existing = this.sourceToVirtual.get(dep.path);

        if (existing) {
            return existing;
        }

        const { extension } = extractStemAndExtension(dep.path);

        const virtualPath =
            `__deps/${this.sourceToVirtual.size}` +
            (extension ? `.${extension}` : '');

        this.sourceToVirtual.set(dep.path, virtualPath);

        this.virtualToSource.set(virtualPath, dep.sourcePath);

        return virtualPath;
    }

    private normalizeVirtualPath(path: string): string {
        path = path.replaceAll('\\', '/');

        if (path.startsWith('/work/')) {
            path = path.slice('/work/'.length);
        }

        return path;
    }
}