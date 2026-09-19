import { Command, Modal, Notice, TFile } from "obsidian";
import { CompileStatus } from "src/latexRender/compiler/base/compilerBase/engine";
import { getLatexTaskSectionInfosFromFile } from "src/latexRender/resolvers/taskSectionInformation";
import { LatexTask } from "src/latexRender/task/latexTask";
import LatexCompilerPlugin from "src/main";

export function createBenchmarkCurrentFileCommand(
    plugin: LatexCompilerPlugin,
): Command {
    return {
        id: 'benchmark-current-file',
        name: 'Benchmark Current File LaTeX Code Blocks',
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();

            if (!file) {
                new Notice('No active file.');
                return;
            }

            const benchmark = new BenchmarkCurrentFileTest(
                    file.path,
                    plugin,
                );

            await benchmark.start();
        },
    };
}

interface BenchmarkIteration {
    durations: number[];
    totalDuration: number;
    averageDuration: number;
}

interface BenchmarkResult {
    iterations: BenchmarkIteration[];
    medianIterationAverage: number;
    blockMedianDurations: number[];
}

//RUN ONLY WHEN DEV CONSOLE IS CLOSED!!! (having it open will cause the benchmark to be slower and results will be inaccurate)
class BenchmarkCurrentFileTest {
    private readonly modal: Modal;

    constructor(
        private readonly filePath: string,
        private readonly plugin: LatexCompilerPlugin,
        private readonly iterations: number = 5,
    ) {
        this.modal = new Modal(this.plugin.app);
        this.modal.contentEl.style.whiteSpace = 'pre-wrap';
    }

    async start() {
        const file = this.plugin.app.vault.getAbstractFileByPath(this.filePath);

        if (!(file instanceof TFile)) {
            throw new Error( `Invalid file path: ${this.filePath}`);
        }

        this.modal.open();

        const renderer = this.plugin.latexRenderer;

        const codeBlocks = await getLatexTaskSectionInfosFromFile(
                file,
                this.plugin.app,
            );

        const tasks: LatexTask[] = [];

        this.setStatus(`Preparing benchmark for ${file.name}...`);

        await renderer.restartCompiler();

        for (const codeBlock of codeBlocks) {
            const task = LatexTask.fromSectionInfos(
                    this.plugin,
                    file.path,
                    [codeBlock],
                );

            const compileResult = await renderer.detachedProcessAndRender(task);

            if (!compileResult.result.isStatus( CompileStatus.Success)) {
                new Notice(
                    `Compilation failed for code block in ${file.path}: ${compileResult.result.status}`,
                );

                continue;
            }

            tasks.push(task);
        }

        if (tasks.length === 0) {
            this.setStatus('No successfully compiling LaTeX code blocks found.',);
            return;
        }

        const iterations: BenchmarkIteration[] = [];

        for (let i = 0;  i < this.iterations; i++) {
            this.setStatus(
                `Benchmarking ${file.name}\n` +
                `Iteration ${i + 1}/${this.iterations}`,
            );

            const durations = await this.benchmark(tasks);

            const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);

            iterations.push({
                durations,
                totalDuration,
                averageDuration: totalDuration / durations.length,
            });
        }

        const result = this.buildResult(iterations);

        this.showResult(file, result);
    }

    private async benchmark(tasks: LatexTask[]): Promise<number[]> {
        const durations: number[] = [];

        for (const task of tasks) {
            const startTime = performance.now();

            await this.plugin.latexRenderer.detachedProcessAndRender(task);
            
            durations.push(performance.now() - startTime);
        }
        return durations;
    }

    private buildResult(iterations: BenchmarkIteration[]): BenchmarkResult {
        const iterationAverages = iterations.map(iteration => iteration.averageDuration);

        const blockCount = iterations[0].durations.length;

        const blockMedianDurations =
            Array.from(
                { length: blockCount },
                (_, blockIndex) => {
                    const samples = iterations.map(iteration => iteration.durations[blockIndex]);
                    return median(samples);
                },
            );

        return {
            iterations,
            medianIterationAverage: median(iterationAverages),
            blockMedianDurations,
        };
    }

    private showResult(file: TFile, result: BenchmarkResult) {
        const iterationLines =
            result.iterations.map(
                (iteration, index) =>
                    `Iteration ${index + 1}: ` +
                    `${iteration.averageDuration.toFixed(2)} ms avg ` +
                    `(${iteration.totalDuration.toFixed(2)} ms total)`,
            );

        const blockLines =
            result.blockMedianDurations.map(
                (duration, index) =>
                    `Code block ${index + 1}: ` +
                    `${duration.toFixed(2)} ms`,
            );

        this.setStatus(
            `Benchmark complete: ${file.name}\n\n` +
            `Blocks: ${result.blockMedianDurations.length}\n` +
            `Iterations: ${result.iterations.length}\n` +
            `Median iteration average: ` +
            `${result.medianIterationAverage.toFixed(2)} ms\n\n` +
            `Iterations:\n` +
            iterationLines.join('\n') +
            `\n\nPer-block medians:\n` +
            blockLines.join('\n'),
        );
    }

    private setStatus(text: string) {
        this.modal.contentEl.setText(text);
    }
}

function median(values: number[]): number {
    if (values.length === 0) { return NaN; }

    const sorted = [...values].sort((a, b) => a - b);

    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }

    return (sorted[middle - 1] + sorted[middle]) / 2;
}