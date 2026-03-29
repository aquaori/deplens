import readline from "readline";
import chalk from "chalk";
import { ArgumentsCamelCase } from "yargs";
import { analyzeProject } from "../analyzer";
import { AnalysisCliArgs, AnalysisReport, ReviewStructuredAnswer } from "../types";
import {
	getPackageNames,
	getProblematicPackages,
	getProjectSummary,
} from "../query";
import { createReviewRuntime, ensureReviewAiConfig, prepareReviewRuntime, ReviewFallbackRequiredError, ReviewRuntime } from "./base";
import { renderStructuredAnswer } from "./render";

type ReviewArgs = ArgumentsCamelCase<AnalysisCliArgs>;
type ScreenMode = "welcome" | "chat";
type MessageRole = "user" | "assistant" | "system";

interface ChatMessage {
	role: MessageRole;
	content: string;
}

const PRIMARY = chalk.hex("#66d9ff");
const ACCENT = chalk.hex("#8df0c8");
const USER = chalk.hex("#ffd166");
const ASSISTANT = chalk.hex("#7dd3fc");
const SYSTEM = chalk.hex("#c4b5fd");
const MUTED = chalk.hex("#97a3b6");
const SOFT = chalk.hex("#c9d2dd");
const BORDER = chalk.hex("#2a3441");
const PANEL = chalk.bgHex("#0f131a");
const SPINNER = ["|    ", "/    ", "-    ", "\\    "];

const DEPLENS_LOGO = [
	"██████╗ ███████╗██████╗ ██╗     ███████╗███╗   ██╗███████╗",
	"██╔══██╗██╔════╝██╔══██╗██║     ██╔════╝████╗  ██║██╔════╝",
	"██║  ██║█████╗  ██████╔╝██║     █████╗  ██╔██╗ ██║███████╗",
	"██║  ██║██╔══╝  ██╔═══╝ ██║     ██╔══╝  ██║╚██╗██║╚════██║",
	"██████╔╝███████╗██║     ███████╗███████╗██║ ╚████║███████║",
	"╚═════╝ ╚══════╝╚═╝     ╚══════╝╚══════╝╚═╝  ╚═══╝╚══════╝",
];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(input: string): string {
	return input.replace(/\u001B\[[0-9;]*m/g, "");
}

function charWidth(char: string): number {
	const codePoint = char.codePointAt(0);
	if (codePoint === undefined) {
		return 0;
	}

	if (
		codePoint === 0 ||
		(codePoint >= 0x0000 && codePoint < 0x0020) ||
		(codePoint >= 0x007f && codePoint < 0x00a0)
	) {
		return 0;
	}

	if (
		codePoint >= 0x1100 && (
			codePoint <= 0x115f ||
			codePoint === 0x2329 ||
			codePoint === 0x232a ||
			(codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
			(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
			(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
			(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
			(codePoint >= 0xff00 && codePoint <= 0xff60) ||
			(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
			(codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
			(codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
			(codePoint >= 0x20000 && codePoint <= 0x3fffd)
		)
	) {
		return 2;
	}

	return 1;
}

function textWidth(input: string): number {
	let width = 0;
	for (const char of stripAnsi(input)) {
		width += charWidth(char);
	}
	return width;
}

function sliceByWidth(input: string, width: number): { head: string; rest: string } {
	if (width <= 0) {
		return { head: "", rest: input };
	}

	let consumedWidth = 0;
	let splitIndex = 0;

	for (const char of input) {
		const nextWidth = consumedWidth + charWidth(char);
		if (nextWidth > width) {
			break;
		}
		consumedWidth = nextWidth;
		splitIndex += char.length;
	}

	return {
		head: input.slice(0, splitIndex),
		rest: input.slice(splitIndex),
	};
}

function repeat(value: string, count: number): string {
	return count > 0 ? value.repeat(count) : "";
}

function padRight(input: string, width: number): string {
	return input + repeat(" ", Math.max(0, width - textWidth(input)));
}

function truncate(input: string, width: number): string {
	if (width <= 0) {
		return "";
	}
	if (textWidth(input) <= width) {
		return input;
	}
	if (width <= 3) {
		return sliceByWidth(input, width).head;
	}
	return `${sliceByWidth(input, width - 3).head}...`;
}

function wrapText(text: string, width: number): string[] {
	if (width <= 1) {
		return [text];
	}

	const paragraphs = text.replace(/\r\n/g, "\n").split("\n");
	const lines: string[] = [];

	for (const paragraph of paragraphs) {
		if (paragraph.trim() === "") {
			lines.push("");
			continue;
		}

		let remaining = paragraph;
		while (textWidth(remaining) > width) {
			const { head, rest } = sliceByWidth(remaining, width);
			let slice = head;
			let nextRemaining = rest;

			const lastSpace = slice.lastIndexOf(" ");
			if (lastSpace > Math.floor(slice.length * 0.4)) {
				nextRemaining = `${slice.slice(lastSpace + 1)}${rest}`;
				slice = slice.slice(0, lastSpace);
			}

			lines.push(slice);
			remaining = nextRemaining.trimStart();
		}
		lines.push(remaining);
	}

	return lines;
}

function centerLine(line: string, width: number): string {
	const left = Math.max(0, Math.floor((width - textWidth(line)) / 2));
	return `${repeat(" ", left)}${line}`;
}

function clearScreen(): void {
	process.stdout.write("\x1b[2J\x1b[H");
}

function enterAltScreen(): void {
	process.stdout.write("\x1b[?1049h\x1b[?25h");
}

function leaveAltScreen(): void {
	process.stdout.write("\x1b[?1049l\x1b[?25h");
}

function writeRow(row: number, text: string): void {
	readline.cursorTo(process.stdout, 0, row);
	readline.clearLine(process.stdout, 0);
	process.stdout.write(text);
}

function formatProjectKind(report: AnalysisReport): string {
	return report.kind === "project" ? "single project" : `monorepo / ${report.monorepoType}`;
}

function buildWelcomeCopy(report: AnalysisReport, projectPath: string): string[] {
	const summary = getProjectSummary(report);
	const hotspots = getProblematicPackages(report, 3);
	const packages = getPackageNames(report);

	const lines = [
		"Dependency review workspace is ready.",
		`Project: ${projectPath}`,
		report.kind === "project"
			? `Mode: single project / package ${packages[0]}`
			: `Mode: monorepo / ${report.monorepoType} / ${summary.packageCount} packages`,
		`Snapshot: ${summary.totalIssues} issues  ${summary.totalDeclarations} declarations  ${summary.totalReferences} references`,
	];

	if (report.kind === "monorepo" && hotspots.length > 0) {
		lines.push(`Hotspots: ${hotspots.map((item) => `${item.packageName}(${item.issueCount})`).join(", ")}`);
	}

	lines.push("");
	lines.push("Try asking:");
	lines.push("- Which dependencies are unused?");
	lines.push("- Which package has the most dependency issues?");
	lines.push("- Can react-dom be removed, and why?");
	lines.push("");
	lines.push("Commands: /help  /summary  /packages  /reset  /clear  /exit");
	return lines;
}

async function withLoadingScreen<T>(label: string, task: () => Promise<T>): Promise<T> {
	if (!process.stdout.isTTY) {
		return task();
	}

	enterAltScreen();
	let frame = 0;

	const render = () => {
		const columns = Math.max(80, process.stdout.columns || 100);
		const rows = Math.max(26, process.stdout.rows || 30);
		const logo = DEPLENS_LOGO.map((line, index) => {
			if (index < 2) return PRIMARY(line);
			if (index < 4) return chalk.hex("#84d889")(line);
			return chalk.hex("#f4c76a")(line);
		});
		const copy = [
			MUTED("Preparing cached dependency context"),
			SOFT("One scan, then continuous conversation on the same analysis snapshot."),
			"",
			PRIMARY(`${SPINNER[frame % SPINNER.length]} ${label}`),
		];
		const content = [...logo, "", ...copy];
		const top = Math.max(0, Math.floor((rows - content.length) / 2));

		clearScreen();
		for (let i = 0; i < top; i++) {
			process.stdout.write("\n");
		}
		for (const line of content) {
			process.stdout.write(`${centerLine(line, columns)}\n`);
		}
	};

	render();
	const timer = setInterval(() => {
		frame += 1;
		render();
	}, 120);

	try {
		return await task();
	} finally {
		clearInterval(timer);
	}
}

class ReviewTui {
	private readonly report: AnalysisReport;
	private readonly runtime: ReviewRuntime;
	private readonly projectPath: string;
	private readonly rl: readline.Interface;
	private readonly messages: ChatMessage[] = [];
	private mode: ScreenMode = "welcome";
	private status = "Ready";
	private spinnerIndex = 0;
	private spinnerTimer: NodeJS.Timeout | null = null;
	private scrollOffset = 0;
	private closed = false;
	private resolveClose: (() => void) | null = null;

	constructor(report: AnalysisReport, projectPath: string, runtime: ReviewRuntime) {
		this.report = report;
		this.projectPath = projectPath;
		this.runtime = runtime;
		this.runtime.setStatusListener((status) => {
			if (this.closed || this.mode !== "chat") {
				return;
			}
			if (status) {
				this.startSpinner(status);
			}
		});
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			historySize: 0,
			terminal: true,
		});
	}

	async open(initialQuestion?: string): Promise<void> {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new Error("Interactive review mode requires a TTY terminal.");
		}

		readline.emitKeypressEvents(process.stdin, this.rl);
		process.stdin.on("keypress", this.handleKeypress);
		process.stdout.on("resize", this.handleResize);
		this.rl.on("SIGINT", () => this.close());
		this.renderFull();

		if (initialQuestion && initialQuestion.trim() !== "") {
			await this.enterChatMode(true);
			await this.submit(initialQuestion.trim());
		}

		return new Promise((resolve) => {
			this.resolveClose = resolve;
			this.promptLoop().catch((error) => {
				this.appendSystemMessage(`Review failed: ${error instanceof Error ? error.message : String(error)}`);
				this.status = "Error";
				this.renderFull();
				this.close();
			});
		});
	}

	private handleResize = () => {
		this.renderFull();
	};

	private handleKeypress = (_input: string, key: readline.Key) => {
		if (this.closed || this.mode !== "chat") {
			return;
		}

		if (key.name === "up") {
			this.scrollBy(4);
			return;
		}

		if (key.name === "down") {
			this.scrollBy(-4);
			return;
		}

		if (key.name === "pageup") {
			this.scrollBy(12);
			return;
		}

		if (key.name === "pagedown") {
			this.scrollBy(-12);
		}
	};

	private async promptLoop(): Promise<void> {
		while (!this.closed) {
			const input = await this.askInput();
			if (this.closed) {
				break;
			}

			const value = input.trim();
			if (!value) {
				this.renderPrompt();
				continue;
			}

			if (value.startsWith("/")) {
				const shouldContinue = await this.handleCommand(value);
				if (!shouldContinue) {
					break;
				}
				continue;
			}

			if (this.mode === "welcome") {
				await this.enterChatMode();
			}

			await this.submit(value);
		}

		this.close();
	}

	private askInput(): Promise<string> {
		this.renderPrompt();
		return new Promise((resolve) => {
			this.rl.question(chalk.white("> "), (answer) => resolve(answer));
		});
	}

	private askInline(prompt: string): Promise<string> {
		this.renderPrompt();
		return new Promise((resolve) => {
			this.rl.question(chalk.white(prompt), (answer) => resolve(answer.trim()));
		});
	}

	private renderPrompt(): void {
		if (this.mode !== "chat") {
			const row = (process.stdout.rows || 30) - 3;
			readline.cursorTo(process.stdout, 0, row);
			return;
		}

		const row = (process.stdout.rows || 30) - 2;
		readline.cursorTo(process.stdout, 3, row);
		readline.clearLine(process.stdout, 1);
	}

	private async enterChatMode(immediate: boolean = false): Promise<void> {
		if (this.mode === "chat") {
			return;
		}

		if (!immediate) {
			const columns = Math.max(80, process.stdout.columns || 100);
			const bodyRow = Math.max(4, Math.floor((process.stdout.rows || 30) / 2));
			for (const label of ["Opening chat", "Opening chat.", "Opening chat..", "Opening chat..."]) {
				writeRow(bodyRow, centerLine(ACCENT(label), columns));
				await sleep(70);
			}
		}

		this.mode = "chat";
		this.status = "Ready";
		this.messages.length = 0;
		this.scrollOffset = 0;
		this.appendSystemMessage(this.buildContextMessage());
		this.renderFull();
	}

	private buildContextMessage(): string {
		const summary = getProjectSummary(this.report);
		const hotspots = getProblematicPackages(this.report, 3);
		const packages = getPackageNames(this.report);
		const lines = [
			"Cached review context is ready.",
			`Project: ${this.projectPath}`,
			`Mode: ${formatProjectKind(this.report)}`,
			`Snapshot: ${summary.totalIssues} issues | ${summary.totalDeclarations} declarations | ${summary.totalReferences} references`,
		];

		if (this.report.kind === "monorepo" && hotspots.length > 0) {
			lines.push(`Hotspots: ${hotspots.map((item) => `${item.packageName}(${item.issueCount})`).join(", ")}`);
		} else {
			lines.push(`Package: ${packages[0]}`);
		}

		lines.push("Ask about unused dependencies, ghost dependencies, package summaries, or removal risk.");
		if (this.runtime.preparation.reviewedCandidateCount > 0) {
			lines.push(
				`AI pre-review: ${this.runtime.preparation.reviewedCandidateCount} low-confidence dependencies reviewed (${this.runtime.preparation.likelyToolingUsageCount} likely tooling, ${this.runtime.preparation.needsReviewCount} still ambiguous).`
			);
		} else {
			lines.push("AI pre-review is off. Unused dependency lists are coarse screening results; ask about a specific dependency before removing it.");
		}
		return lines.join("\n");
	}

	private async handleCommand(command: string): Promise<boolean> {
		switch (command) {
			case "/help":
				if (this.mode === "welcome") {
					await this.enterChatMode();
				}
				this.appendSystemMessage([
					"Commands",
					"/help      Show command help",
					"/summary   Show cached project summary",
					"/packages  Show known package names",
					"/reset     Clear conversation history but keep the cached report",
					"/clear     Clear the message panel",
					"/exit      Exit review mode",
				].join("\n"));
				this.status = "Showing help";
				this.renderFull();
				return true;
			case "/summary":
				if (this.mode === "welcome") {
					await this.enterChatMode();
				}
				this.appendSystemMessage(this.buildSummaryText());
				this.status = "Showing cached summary";
				this.renderFull();
				return true;
			case "/packages":
				if (this.mode === "welcome") {
					await this.enterChatMode();
				}
				this.appendSystemMessage(this.buildPackagesText());
				this.status = "Showing package list";
				this.renderFull();
				return true;
			case "/reset":
				this.runtime.reset();
				this.mode = "welcome";
				this.messages.length = 0;
				this.scrollOffset = 0;
				this.status = "Conversation history cleared";
				this.renderFull();
				return true;
			case "/clear":
				if (this.mode === "chat") {
					this.messages.length = 0;
					this.scrollOffset = 0;
					this.appendSystemMessage(this.buildContextMessage());
				}
				this.status = "Message panel cleared";
				this.renderFull();
				return true;
			case "/exit":
			case "/quit":
				return false;
			default:
				if (this.mode === "welcome") {
					await this.enterChatMode();
				}
				this.appendSystemMessage(`Unknown command: ${command}\nUse /help to see available commands.`);
				this.status = "Unknown command";
				this.renderFull();
				return true;
		}
	}

	private async submit(question: string): Promise<void> {
		this.scrollOffset = 0;
		this.messages.push({ role: "user", content: question });
		this.messages.push({ role: "assistant", content: "" });
		this.startSpinner("Analyzing question");
		this.renderDynamicChat();

		try {
			const answer = await this.runtime.ask(question);
			this.startSpinner("Rendering answer");
			await this.streamAnswer(answer);
			this.status = "Ready";
		} catch (error) {
			if (error instanceof ReviewFallbackRequiredError) {
				this.messages.pop();
				await this.handleComplexQuestionFallback(error.question, error.message);
				return;
			}
			this.replaceAssistantMessage(`Review failed: ${error instanceof Error ? error.message : String(error)}`);
			this.status = "Error";
		} finally {
			this.stopSpinner();
			this.renderFull();
		}
	}

	private async handleComplexQuestionFallback(question: string, reason: string): Promise<void> {
		this.appendSystemMessage([
			"This question is more complex than the current tool routing can answer reliably.",
			reason,
			"",
			"Continuing with deep analysis will send the full report and evidence to the model and may consume many tokens.",
			"Choose:",
			"1. Continue with deep analysis",
			"2. Add more detail and retry",
			"3. Cancel this answer",
		].join("\n"));
		this.status = "Awaiting complexity choice";
		this.renderFull();

		const choice = await this.askInline("Choose 1/2/3 > ");

		if (choice === "1") {
			this.messages.push({ role: "assistant", content: "" });
			this.startSpinner("Preparing deep analysis");
			this.renderDynamicChat();
			try {
				const answer = await this.runtime.deepAsk(question);
				this.startSpinner("Rendering answer");
				await this.streamAnswer(answer);
				this.status = "Ready";
			} catch (error) {
				this.replaceAssistantMessage(`Deep analysis failed: ${error instanceof Error ? error.message : String(error)}`);
				this.status = "Error";
			}
			return;
		}

		if (choice === "2") {
			const extra = await this.askInline("Add more detail > ");
			if (!extra) {
				this.appendSystemMessage("No extra detail was provided. The current answer was cancelled.");
				this.status = "Cancelled";
				return;
			}
			this.appendSystemMessage("Got it. Retrying with the extra detail merged into the original question.");
			await this.submit(`${question}\n\nAdditional detail: ${extra}`);
			return;
		}

		this.appendSystemMessage("Cancelled the high-cost analysis. You can try a narrower question next.");
		this.status = "Cancelled";
	}

	private async streamAnswer(answer: ReviewStructuredAnswer): Promise<void> {
		const output = renderStructuredAnswer(answer);
		let content = "";
		for (let i = 0; i < output.length; i += 6) {
			content += output.slice(i, i + 6);
			this.replaceAssistantMessage(content);
			this.renderDynamicChat();
			await sleep(5);
		}
	}

	private startSpinner(label: string): void {
		this.stopSpinner();
		this.status = `${SPINNER[this.spinnerIndex]} ${label}`;
		this.spinnerTimer = setInterval(() => {
			this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER.length;
			this.status = `${SPINNER[this.spinnerIndex]} ${label}`;
			this.renderStatusOnly();
		}, 120);
	}

	private stopSpinner(): void {
		if (this.spinnerTimer) {
			clearInterval(this.spinnerTimer);
			this.spinnerTimer = null;
		}
		this.spinnerIndex = 0;
	}

	private appendSystemMessage(content: string): void {
		this.messages.push({ role: "system", content });
	}

	private replaceAssistantMessage(content: string): void {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const message = this.messages[i];
			if (message && message.role === "assistant") {
				message.content = content;
				return;
			}
		}
		this.messages.push({ role: "assistant", content });
	}

	private buildSummaryText(): string {
		const summary = getProjectSummary(this.report);
		const ranking = getProblematicPackages(this.report, 5);
		const lines = [
			"Cached Summary",
			`Kind: ${summary.kind}`,
			`Packages: ${summary.packageCount}`,
			`Issues: ${summary.totalIssues}`,
			`Unused packages: ${summary.packagesWithUnusedDependencies}`,
			`Ghost packages: ${summary.packagesWithGhostDependencies}`,
		];

		if (summary.monorepoType) {
			lines.push(`Monorepo type: ${summary.monorepoType}`);
		}

		if (ranking.length > 0) {
			lines.push("");
			lines.push("Most problematic packages:");
			for (const item of ranking) {
				lines.push(
					`- ${item.packageName} | issues=${item.issueCount} unused=${item.unusedDependencyCount} ghost=${item.ghostDependencyCount} undeclaredWorkspace=${item.undeclaredWorkspaceDependencyCount}`
				);
			}
		}

		return lines.join("\n");
	}

	private buildPackagesText(): string {
		return ["Known packages", ...getPackageNames(this.report).map((item) => `- ${item}`)].join("\n");
	}

	private getBodyLines(maxWidth: number): string[] {
		const lines: string[] = [];

		for (const message of this.messages) {
			const label =
				message.role === "user"
					? USER("You")
					: message.role === "assistant"
						? ASSISTANT("Deplens")
						: SYSTEM("Context");
			lines.push(`  ${label}`);
			for (const wrapped of wrapText(message.content, maxWidth)) {
				lines.push(`    ${wrapped}`);
			}
			lines.push("");
		}

		return lines;
	}

	private scrollBy(delta: number): void {
		const columns = Math.max(80, process.stdout.columns || 100);
		const rows = Math.max(26, process.stdout.rows || 30);
		const bodyHeight = rows - 8;
		const totalLines = this.getBodyLines(columns - 8).length;
		const maxOffset = Math.max(0, totalLines - bodyHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, maxOffset));
		this.renderDynamicChat();
	}

	private renderFull(): void {
		clearScreen();
		if (this.mode === "welcome") {
			this.renderWelcomeScreen();
		} else {
			this.renderChatScreen();
		}
		this.renderPrompt();
	}

	private renderWelcomeScreen(): void {
		const columns = Math.max(80, process.stdout.columns || 100);
		const rows = Math.max(26, process.stdout.rows || 30);
		const content = [
			...DEPLENS_LOGO.map((line, index) => {
				if (index < 2) return PRIMARY(line);
				if (index < 4) return chalk.hex("#84d889")(line);
				return chalk.hex("#f4c76a")(line);
			}),
			"",
			...buildWelcomeCopy(this.report, this.projectPath).map((line) => SOFT(line)),
		];
		const top = Math.max(0, Math.floor((rows - content.length - 5) / 2));

		for (let i = 0; i < top; i++) {
			process.stdout.write("\n");
		}
		for (const line of content) {
			process.stdout.write(`${centerLine(line, columns)}\n`);
		}

		const footerStart = rows - 5;
		writeRow(footerStart, BORDER(repeat("-", columns)));
		writeRow(footerStart + 1, `${BORDER("|")}${padRight(`  ${MUTED("Welcome")}`, columns - 2)}${BORDER("|")}`);
		writeRow(footerStart + 2, `${BORDER("|")}${padRight("  ", columns - 2)}${BORDER("|")}`);
		writeRow(footerStart + 3, BORDER(repeat("-", columns)));
		writeRow(footerStart + 4, padRight(`${ACCENT(`Status: ${this.status}`)}  ${MUTED("Type a question and press Enter to start chatting")}`, columns));
	}

	private renderChatScreen(): void {
		const columns = Math.max(80, process.stdout.columns || 100);
		const summary = getProjectSummary(this.report);
		const title = PRIMARY("Deplens Review");
		const right = MUTED(`${formatProjectKind(this.report)}  ${summary.packageCount} pkg  ${summary.totalIssues} issues`);
		const spacer = Math.max(1, columns - textWidth(title) - textWidth(right));

		writeRow(0, PANEL(padRight(`${title}${repeat(" ", spacer)}${right}`, columns)));
		writeRow(1, PANEL(padRight(MUTED(truncate(this.projectPath, columns)), columns)));
		writeRow(2, BORDER(repeat("-", columns)));
		this.renderBodyOnly();
		this.renderStatusOnly();
		this.renderInputShell();
	}

	private renderBodyOnly(): void {
		if (this.mode !== "chat") {
			return;
		}

		const columns = Math.max(80, process.stdout.columns || 100);
		const rows = Math.max(26, process.stdout.rows || 30);
		const bodyStart = 3;
		const bodyHeight = rows - 8;
		const lines = this.getBodyLines(columns - 8);
		const maxOffset = Math.max(0, lines.length - bodyHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		const start = Math.max(0, lines.length - bodyHeight - this.scrollOffset);
		const visible = lines.slice(start, start + bodyHeight);

		while (visible.length < bodyHeight) {
			visible.push("");
		}

		for (let i = 0; i < bodyHeight; i++) {
			writeRow(bodyStart + i, padRight(visible[i] ?? "", columns));
		}
	}

	private renderStatusOnly(): void {
		if (this.mode !== "chat") {
			return;
		}

		const columns = Math.max(80, process.stdout.columns || 100);
		const rows = Math.max(26, process.stdout.rows || 30);
		const statusRow = rows - 5;
		const totalLines = this.getBodyLines(columns - 8).length;
		const bodyHeight = rows - 8;
		const maxOffset = Math.max(0, totalLines - bodyHeight);
		const scrollHint = this.scrollOffset > 0 ? `history +${this.scrollOffset}` : "latest";
		const left = ACCENT(`Status: ${this.status}`);
		const rightText = `Up/Down scroll  PgUp/PgDn  ${scrollHint}`;
		const right = MUTED(truncate(rightText, Math.max(10, columns - textWidth(left) - 4)));
		const spacer = Math.max(2, columns - textWidth(left) - textWidth(right));

		writeRow(statusRow, BORDER(repeat("-", columns)));
		writeRow(statusRow + 1, padRight(`${left}${repeat(" ", spacer)}${right}`, columns));
	}

	private renderInputShell(): void {
		if (this.mode !== "chat") {
			return;
		}

		const columns = Math.max(80, process.stdout.columns || 100);
		const rows = Math.max(26, process.stdout.rows || 30);
		const shellRow = rows - 3;
		const inner = columns - 2;
		writeRow(shellRow, `${BORDER("+")}${BORDER(repeat("-", inner))}${BORDER("+")}`);
		writeRow(shellRow + 1, `${BORDER("|")}${padRight(`  ${MUTED("Ask Deplens anything about this project")}`, inner)}${BORDER("|")}`);
		writeRow(shellRow + 2, `${BORDER("+")}${BORDER(repeat("-", inner))}${BORDER("+")}`);
	}

	private renderDynamicChat(): void {
		this.renderBodyOnly();
		this.renderStatusOnly();
		this.renderPrompt();
	}

	private close(): void {
		if (this.closed) {
			return;
		}

		this.closed = true;
		this.runtime.setStatusListener(null);
		this.stopSpinner();
		process.stdin.off("keypress", this.handleKeypress);
		process.stdout.off("resize", this.handleResize);
		this.rl.close();
		leaveAltScreen();
		if (this.resolveClose) {
			this.resolveClose();
			this.resolveClose = null;
		}
	}
}

export async function startInteractiveReviewSession(
	args: ReviewArgs,
	initialQuestion?: string
): Promise<void> {
	ensureReviewAiConfig();

	const report = await withLoadingScreen("Scanning project", async () => {
		return analyzeProject(
			{
				...args,
				silence: true,
				json: false,
				output: "",
			},
			false
		);
	});

	if (Array.isArray(report)) {
		leaveAltScreen();
		throw new Error("Interactive review mode requires a structured analysis report.");
	}

	const runtime = args.preReview
		? await withLoadingScreen("Pre-reviewing low-confidence dependencies", async () => {
			return prepareReviewRuntime(report);
		})
		: createReviewRuntime(report);
	const tui = new ReviewTui(report, args.path, runtime);
	await tui.open(initialQuestion);
}
