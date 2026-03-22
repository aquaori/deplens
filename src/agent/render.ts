import {
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

function renderSectionLines(section: ReviewSection): string[] {
	const lines: string[] = [];

	if (section.title) {
		lines.push(cleanTitle(section.title));
	}

	switch (section.type) {
		case "paragraph":
			if (section.body) {
				lines.push(normalizeMultilineText(section.body));
			}
			break;
		case "bullet_list":
			for (const item of section.items || []) {
				lines.push(`- ${normalizeMultilineText(item)}`);
			}
			break;
		case "numbered_list":
			(section.items || []).forEach((item, index) => {
				lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
			});
			break;
		case "kv_list":
			for (const pair of section.pairs || []) {
				lines.push(`- ${normalizeMultilineText(pair.key)}: ${normalizeMultilineText(pair.value)}`);
			}
			break;
		case "code":
			if (section.body) {
				lines.push(normalizeMultilineText(section.body));
			}
			if (section.code) {
				for (const codeLine of section.code.replace(/\r\n/g, "\n").split("\n")) {
					lines.push(`    ${codeLine}`);
				}
			}
			break;
		default:
			if (section.body) {
				lines.push(normalizeMultilineText(section.body));
			}
			break;
	}

	return lines.filter((line) => line.trim() !== "");
}

function pushSectionBlock(lines: string[], section: ReviewSection): void {
	const sectionLines = renderSectionLines(section);
	if (sectionLines.length === 0) {
		return;
	}
	if (lines.length > 0) {
		lines.push("");
	}
	lines.push(...sectionLines);
}

function renderDefault(answer: ReviewStructuredAnswer): string {
	const lines: string[] = [cleanTitle(answer.title)];

	if (answer.summary) {
		lines.push("");
		lines.push(normalizeMultilineText(answer.summary));
	}

	for (const section of answer.sections) {
		pushSectionBlock(lines, section);
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push("Next actions");
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderDependencyList(answer: ReviewStructuredAnswer): string {
	const lines: string[] = [cleanTitle(answer.title)];

	if (answer.summary) {
		lines.push("");
		lines.push(normalizeMultilineText(answer.summary));
	}

	for (const section of answer.sections) {
		if (section.title) {
			lines.push("");
			lines.push(divider(cleanTitle(section.title)));
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${normalizeMultilineText(pair.key)}: ${normalizeMultilineText(pair.value)}`);
			}
			continue;
		}

		const items = section.items || [];
		if (items.length > 0) {
			lines.push(`Count: ${items.length}`);
			for (const item of items) {
				lines.push(`- ${normalizeMultilineText(item)}`);
			}
			continue;
		}

		if (section.body) {
			lines.push(normalizeMultilineText(section.body));
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push("Suggested follow-ups");
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderPlan(answer: ReviewStructuredAnswer): string {
	const lines: string[] = [cleanTitle(answer.title)];

	if (answer.summary) {
		lines.push("");
		lines.push(normalizeMultilineText(answer.summary));
	}

	let phaseIndex = 1;
	for (const section of answer.sections) {
		lines.push("");
		const sectionTitle = section.title
			? `Phase ${phaseIndex}: ${cleanTitle(section.title)}`
			: `Phase ${phaseIndex}`;
		lines.push(divider(sectionTitle));
		phaseIndex += 1;

		if (section.body) {
			lines.push(normalizeMultilineText(section.body));
		}

		if (section.type === "numbered_list" || section.type === "bullet_list") {
			const items = section.items || [];
			items.forEach((item, index) => {
				if (section.type === "numbered_list") {
					lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
				} else {
					lines.push(`- ${normalizeMultilineText(item)}`);
				}
			});
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${normalizeMultilineText(pair.key)}: ${normalizeMultilineText(pair.value)}`);
			}
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push("Suggested follow-ups");
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderAssessment(answer: ReviewStructuredAnswer): string {
	const lines: string[] = [cleanTitle(answer.title)];

	if (answer.summary) {
		lines.push("");
		lines.push(divider("Conclusion"));
		lines.push(normalizeMultilineText(answer.summary));
	}

	for (const section of answer.sections) {
		if (section.title) {
			lines.push("");
			lines.push(divider(cleanTitle(section.title)));
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${normalizeMultilineText(pair.key)}: ${normalizeMultilineText(pair.value)}`);
			}
			continue;
		}

		if (section.type === "bullet_list" || section.type === "numbered_list") {
			(section.items || []).forEach((item, index) => {
				if (section.type === "numbered_list") {
					lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
				} else {
					lines.push(`- ${normalizeMultilineText(item)}`);
				}
			});
			continue;
		}

		if (section.body) {
			lines.push(normalizeMultilineText(section.body));
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push("Recommended next actions");
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
		});
	}

	return lines.join("\n").trim();
}

function renderCodeContext(answer: ReviewStructuredAnswer): string {
	const lines: string[] = [cleanTitle(answer.title)];

	if (answer.summary) {
		lines.push("");
		lines.push(normalizeMultilineText(answer.summary));
	}

	for (const section of answer.sections) {
		if (section.title) {
			lines.push("");
			lines.push(divider(cleanTitle(section.title)));
		}

		if (section.body) {
			lines.push(normalizeMultilineText(section.body));
		}

		if (section.type === "code" && section.code) {
			lines.push(divider("Snippet"));
			for (const codeLine of section.code.replace(/\r\n/g, "\n").split("\n")) {
				lines.push(`    ${codeLine}`);
			}
			continue;
		}

		if (section.type === "kv_list") {
			for (const pair of section.pairs || []) {
				lines.push(`- ${normalizeMultilineText(pair.key)}: ${normalizeMultilineText(pair.value)}`);
			}
			continue;
		}

		if (section.type === "bullet_list" || section.type === "numbered_list") {
			(section.items || []).forEach((item, index) => {
				if (section.type === "numbered_list") {
					lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
				} else {
					lines.push(`- ${normalizeMultilineText(item)}`);
				}
			});
		}
	}

	if (answer.suggestions && answer.suggestions.length > 0) {
		lines.push("");
		lines.push("Suggested follow-ups");
		answer.suggestions.forEach((item, index) => {
			lines.push(`${index + 1}. ${normalizeMultilineText(item)}`);
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

export function buildFallbackStructuredAnswer(rawText: string): ReviewStructuredAnswer {
	return {
		type: "text",
		title: "Response",
		summary: "",
		sections: [
			{
				type: "paragraph",
				body: normalizeMultilineText(rawText),
			},
		],
	};
}
