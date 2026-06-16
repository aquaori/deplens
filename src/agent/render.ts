import chalk from "chalk";
import {
	ReviewLocale,
	ReviewSection,
	ReviewStructuredAnswer,
} from "../types";

function divider(label?: string): string {
	if (!label) {
		return "--------------------------------------------------";
	}
	return `${label}\n--------------------------------------------------`;
}

function removeMarkdownSyntax(input: string): string {
	return input
		.replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/\*\*(.*?)\*\*/g, "$1")
		.replace(/\*(.*?)\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^>\s?/gm, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/^\s*[-*]\s+\[.\]\s+/gm, "- ")
		.replace(/^\s*\|\s*/gm, "")
		.replace(/\s*\|\s*/g, " | ")
		.trim();
}

function normalizeMultilineText(input: string): string {
	return removeMarkdownSyntax(input)
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function cleanTitle(input?: string): string {
	return input ? normalizeMultilineText(input) : "";
}

function styleTitle(text: string, answer: ReviewStructuredAnswer): string {
	const cleaned = cleanTitle(text);
	if (cleaned === "") {
		return "";
	}

	switch (answer.accentTone) {
		case "success":
			return chalk.hex("#8df0c8")(cleaned);
		case "warning":
			return chalk.hex("#ffd166")(cleaned);
		case "muted":
			return chalk.hex("#9aa4b2")(cleaned);
		case "neutral":
			return chalk.hex("#d7dee7")(cleaned);
		case "info":
		default:
			return chalk.hex("#66d9ff")(cleaned);
	}
}

function styleLabel(text: string, answer: ReviewStructuredAnswer): string {
	switch (answer.accentTone) {
		case "success":
			return chalk.hex("#8df0c8")(text);
		case "warning":
			return chalk.hex("#ffd166")(text);
		case "muted":
			return chalk.hex("#a1aab8")(text);
		case "neutral":
			return chalk.hex("#d0d7df")(text);
		case "info":
		default:
			return chalk.hex("#7dd3fc")(text);
	}
}

function styleDivider(text: string): string {
	return chalk.hex("#4b5563")(text);
}

function styleBodyAccent(text: string, tone: ReviewStructuredAnswer["accentTone"]): string {
	switch (tone) {
		case "success":
			return chalk.hex("#8df0c8")(text);
		case "warning":
			return chalk.hex("#ffd166")(text);
		case "muted":
			return chalk.hex("#a1aab8")(text);
		case "neutral":
			return chalk.hex("#d7dee7")(text);
		case "info":
		default:
			return chalk.hex("#7dd3fc")(text);
	}
}

function styleSuccess(text: string): string {
	return chalk.hex("#8df0c8")(text);
}

function styleWarning(text: string): string {
	return chalk.hex("#ffd166")(text);
}

function styleMuted(text: string): string {
	return chalk.hex("#9aa4b2")(text);
}

function styleCodeish(text: string): string {
	return chalk.hex("#c4b5fd")(text);
}

function applyTone(text: string, tone: string, fallbackTone: ReviewStructuredAnswer["accentTone"]): string {
	switch (tone) {
		case "success":
			return styleSuccess(text);
		case "warning":
			return styleWarning(text);
		case "muted":
			return styleMuted(text);
		case "info":
			return styleBodyAccent(text, "info");
		case "neutral":
			return styleBodyAccent(text, "neutral");
		default:
			return styleBodyAccent(text, fallbackTone);
	}
}

function renderMarkedText(text: string, answer: ReviewStructuredAnswer): string {
	let output = text;

	output = output.replace(/<code>([\s\S]*?)<\/code>/gi, (_match, inner) =>
		styleCodeish(String(inner))
	);
	output = output.replace(/<mark(?:\s+tone="(info|success|warning|muted|neutral)")?>([\s\S]*?)<\/mark>/gi, (_match, tone, inner) =>
		applyTone(String(inner), typeof tone === "string" ? tone : "", answer.accentTone)
	);

	return output;
}

function renderBodyLine(line: string, answer: ReviewStructuredAnswer): string {
	return renderMarkedText(normalizeMultilineText(line), answer);
}

function inferLocale(answer: ReviewStructuredAnswer): ReviewLocale {
	if (answer.locale === "zh" || answer.locale === "en") {
		return answer.locale;
	}

	const sample = [
		answer.title,
		answer.summary,
		...answer.sections.flatMap((section) => [
			section.title,
			section.body,
			...(section.items || []),
			...(section.pairs || []).flatMap((pair) => [pair.key, pair.value]),
		]),
		...(answer.suggestions || []),
	]
		.filter((item): item is string => typeof item === "string")
		.join("\n");

	return /[\u4e00-\u9fff]/.test(sample) ? "zh" : "en";
}

function labels(locale: ReviewLocale) {
	return locale === "zh"
		? {
			suggestions: "建议继续确认",
			nextSteps: "建议下一步",
			conclusion: "结论",
			snippet: "代码片段",
			phase: "阶段",
			count: "数量",
			response: "回复",
		}
		: {
			suggestions: "Suggested Follow-ups",
			nextSteps: "Recommended Next Actions",
			conclusion: "Conclusion",
			snippet: "Snippet",
			phase: "Phase",
			count: "Count",
			response: "Response",
		};
}

function renderSectionLines(section: ReviewSection, answer: ReviewStructuredAnswer): string[] {
	const lines: string[] = [];

	if (section.title) {
		lines.push(styleLabel(cleanTitle(section.title), answer));
	}

	switch (section.type) {
		case "paragraph":
			if (section.body) {
				lines.push(renderBodyLine(section.body, answer));
			}
			break;
		case "bullet_list":
			for (const item of section.items || []) {
				lines.push(`- ${renderBodyLine(item, answer)}`);
			}
			break;
		case "numbered_list":
			(section.items || []).forEach((item, index) => {
				lines.push(`${index + 1}. ${renderBodyLine(item, answer)}`);
			});
			break;
		case "kv_list":
			for (const pair of section.pairs || []) {
				lines.push(`- ${styleLabel(normalizeMultilineText(pair.key), answer)}: ${renderBodyLine(pair.value, answer)}`);
			}
			break;
		case "code":
			if (section.body) {
				lines.push(renderBodyLine(section.body, answer));
			}
			if (section.code) {
				for (const codeLine of section.code.replace(/\r\n/g, "\n").split("\n")) {
					lines.push(`    ${styleCodeish(codeLine)}`);
				}
			}
			break;
		default:
			if (section.body) {
				lines.push(renderBodyLine(section.body, answer));
			}
			break;
	}

	return lines.filter((line) => line.trim() !== "");
}

function pushSectionBlock(lines: string[], section: ReviewSection, answer: ReviewStructuredAnswer): void {
	const sectionLines = renderSectionLines(section, answer);
	if (sectionLines.length === 0) {
		return;
	}
	if (lines.length > 0) {
		lines.push("");
	}
	lines.push(...sectionLines);
}

function renderDefault(answer: ReviewStructuredAnswer): string {
	const locale = inferLocale(answer);
	const copy = labels(locale);
	const lines: string[] = [];
	const title = cleanTitle(answer.title);

	if (title) {
		lines.push(styleTitle(title, answer));
	}

	if (answer.summary) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push(renderBodyLine(answer.summary, answer));
	}

	for (const section of answer.sections) {
		pushSectionBlock(lines, section, answer);
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push(styleLabel(copy.nextSteps, answer));
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${renderBodyLine(item, answer)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderDependencyList(answer: ReviewStructuredAnswer): string {
	const locale = inferLocale(answer);
	const copy = labels(locale);
	const lines: string[] = [];
	const title = cleanTitle(answer.title);

	if (title) {
		lines.push(styleTitle(title, answer));
	}

	if (answer.summary) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push(renderBodyLine(answer.summary, answer));
	}

	for (const section of answer.sections) {
		if (section.title) {
			lines.push("");
			lines.push(styleDivider(divider(cleanTitle(section.title))));
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${styleLabel(normalizeMultilineText(pair.key), answer)}: ${renderBodyLine(pair.value, answer)}`);
			}
			continue;
		}

		const items = section.items || [];
		if (items.length > 0) {
			lines.push(styleLabel(`${copy.count}: ${items.length}`, answer));
			for (const item of items) {
				lines.push(`- ${renderBodyLine(item, answer)}`);
			}
			continue;
		}

		if (section.body) {
			lines.push(renderBodyLine(section.body, answer));
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push(styleLabel(copy.suggestions, answer));
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${renderBodyLine(item, answer)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderPlan(answer: ReviewStructuredAnswer): string {
	const locale = inferLocale(answer);
	const copy = labels(locale);
	const lines: string[] = [];
	const title = cleanTitle(answer.title);

	if (title) {
		lines.push(styleTitle(title, answer));
	}

	if (answer.summary) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push(renderBodyLine(answer.summary, answer));
	}

	let phaseIndex = 1;
	for (const section of answer.sections) {
		lines.push("");
		const sectionTitle = section.title
			? `${copy.phase} ${phaseIndex}: ${cleanTitle(section.title)}`
			: `${copy.phase} ${phaseIndex}`;
		lines.push(styleDivider(divider(sectionTitle)));
		phaseIndex += 1;

		if (section.body) {
			lines.push(renderBodyLine(section.body, answer));
		}

		if (section.type === "numbered_list" || section.type === "bullet_list") {
			const items = section.items || [];
			items.forEach((item, index) => {
				if (section.type === "numbered_list") {
					lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
				} else {
					lines.push(`- ${renderBodyLine(item, answer)}`);
				}
			});
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${styleLabel(normalizeMultilineText(pair.key), answer)}: ${renderBodyLine(pair.value, answer)}`);
			}
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push(styleLabel(copy.suggestions, answer));
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${renderBodyLine(item, answer)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderAssessment(answer: ReviewStructuredAnswer): string {
	const locale = inferLocale(answer);
	const copy = labels(locale);
	const lines: string[] = [];
	const title = cleanTitle(answer.title);

	if (title) {
		lines.push(styleTitle(title, answer));
	}

	if (answer.summary) {
		if (answer.displayStyle !== "compact") {
			if (lines.length > 0) {
				lines.push("");
			}
			lines.push(styleDivider(divider(styleLabel(copy.conclusion, answer))));
		} else if (lines.length > 0) {
			lines.push("");
		}
		lines.push(renderBodyLine(answer.summary, answer));
	}

	for (const section of answer.sections) {
		if (section.title) {
			lines.push("");
			lines.push(styleDivider(divider(cleanTitle(section.title))));
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${styleLabel(normalizeMultilineText(pair.key), answer)}: ${renderBodyLine(pair.value, answer)}`);
			}
			continue;
		}

		if (section.type === "bullet_list" || section.type === "numbered_list") {
			(section.items || []).forEach((item, index) => {
				if (section.type === "numbered_list") {
					lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
				} else {
					lines.push(`- ${renderBodyLine(item, answer)}`);
				}
			});
			continue;
		}

		if (section.body) {
			lines.push(renderBodyLine(section.body, answer));
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push(styleLabel(copy.nextSteps, answer));
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${renderBodyLine(item, answer)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderCodeContext(answer: ReviewStructuredAnswer): string {
	const locale = inferLocale(answer);
	const copy = labels(locale);
	const lines: string[] = [];
	const title = cleanTitle(answer.title);

	if (title) {
		lines.push(styleTitle(title, answer));
	}

	if (answer.summary) {
		if (lines.length > 0) {
			lines.push("");
		}
		lines.push(renderBodyLine(answer.summary, answer));
	}

	for (const section of answer.sections) {
		if (section.title) {
			lines.push("");
			lines.push(styleDivider(divider(cleanTitle(section.title))));
		}

		if (section.body) {
			lines.push(renderBodyLine(section.body, answer));
		}

		if (section.type === "code" && section.code) {
			lines.push(styleDivider(divider(copy.snippet)));
			for (const codeLine of section.code.replace(/\r\n/g, "\n").split("\n")) {
				lines.push(`    ${codeLine}`);
			}
			continue;
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${styleLabel(normalizeMultilineText(pair.key), answer)}: ${renderBodyLine(pair.value, answer)}`);
			}
			continue;
		}

		if (section.type === "bullet_list" || section.type === "numbered_list") {
			(section.items || []).forEach((item, index) => {
				if (section.type === "numbered_list") {
					lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
				} else {
					lines.push(`- ${renderBodyLine(item, answer)}`);
				}
			});
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push(styleLabel(copy.suggestions, answer));
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${renderBodyLine(item, answer)}`);
		});
	}

	return lines.join("\n").trim();
}

export function renderStructuredAnswer(answer: ReviewStructuredAnswer): string {
	switch (answer.type) {
		case "dependency_list":
			return renderDependencyList(answer);
		case "plan":
			return renderPlan(answer);
		case "assessment":
			return renderAssessment(answer);
		case "code_context":
			return renderCodeContext(answer);
		case "text":
		default:
			return renderDefault(answer);
	}
}

export function buildFallbackStructuredAnswer(rawText: string, locale: ReviewLocale = "en"): ReviewStructuredAnswer {
	return {
		type: "text",
		locale,
		title: labels(locale).response,
		summary: "",
		sections: [
			{
				type: "paragraph",
				body: normalizeMultilineText(rawText),
			},
		],
		displayStyle: "compact",
		accentTone: "muted",
	};
}
