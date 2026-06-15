import {
	AnswerBuildInput,
	CodeContextSnippet,
	DependencyContextBundle,
	DependencyReviewCandidate,
	PackageIssueRankingView,
	PackageSummaryView,
	ProjectSummaryView,
	RemovalAssessment,
	ReviewLocale,
	ReviewNextStepIntent,
	ReviewStructuredAnswer,
} from "../types";

function labels(locale: ReviewLocale) {
	return locale === "zh"
		? {
			projectSummary: "项目概览",
			packageSummary: "包概览",
			problematicPackages: "问题包排行",
			unusedDependencies: "未使用依赖筛查",
			ghostDependencies: "幽灵依赖",
			reviewCandidate: "依赖复核结论",
			removalAssessment: "移除风险评估",
			codeContext: "本地上下文",
			suggestions: {
				inspect_context: "继续检查相关上下文、配置片段和代码片段。",
				review_candidate: "继续复核这个低置信度依赖候选项。",
				ask_dependency_name: "提供具体依赖名或包名，以便做定向复核。",
				manual_verify_before_remove: "在移除前做一次人工确认，尤其检查脚本、配置和运行时约定。",
				check_problematic_packages: "先查看问题最多的包，再决定清理顺序。",
				review_unused_dependencies: "把未使用依赖结果当作筛查视图，再逐个确认可删项。",
				review_ghost_dependencies: "先确认这些幽灵依赖是否应补声明，而不是直接修改代码。",
			},
		}
		: {
			projectSummary: "Project Summary",
			packageSummary: "Package Summary",
			problematicPackages: "Problematic Packages",
			unusedDependencies: "Unused Dependency Screening",
			ghostDependencies: "Ghost Dependencies",
			reviewCandidate: "Dependency Review",
			removalAssessment: "Removal Assessment",
			codeContext: "Local Context",
			suggestions: {
				inspect_context: "Continue by checking the relevant context, config snippets, and code snippets.",
				review_candidate: "Continue by reviewing this low-confidence dependency candidate.",
				ask_dependency_name: "Provide a specific dependency name or package name for a focused review.",
				manual_verify_before_remove: "Verify manually before removal, especially scripts, config, and runtime conventions.",
				check_problematic_packages: "Check the most problematic packages first before deciding cleanup order.",
				review_unused_dependencies: "Treat unused dependency results as a screening view and confirm removals one by one.",
				review_ghost_dependencies: "Confirm whether these ghost dependencies need declarations before changing code.",
			},
		};
}

function mapSuggestionIntents(intents: ReviewNextStepIntent[] | undefined, locale: ReviewLocale): string[] | undefined {
	if (!intents || intents.length === 0) {
		return undefined;
	}

	const copy = labels(locale);
	return Array.from(new Set(intents))
		.map((intent) => copy.suggestions[intent])
		.filter((item): item is string => !!item);
}

export function buildAnswer(input: AnswerBuildInput): ReviewStructuredAnswer {
	const answer: ReviewStructuredAnswer = {
		type: input.type,
		locale: input.locale,
		title: input.title,
		summary: input.summary || "",
		sections: [
			...(input.metadata && input.metadata.length > 0
				? [{
					type: "kv_list" as const,
					pairs: input.metadata,
				}]
				: []),
			...(input.findings && input.findings.length > 0
				? [{
					type: "bullet_list" as const,
					items: input.findings,
				}]
				: []),
			...(input.citations && input.citations.length > 0
				? [{
					type: "bullet_list" as const,
					title: input.locale === "zh" ? "依据" : "Evidence",
					items: input.citations,
				}]
				: []),
			...(input.codeSnippets || []).map((snippet) => buildCodeSection(snippet)),
		],
	};

	const suggestions = mapSuggestionIntents(input.nextActionIntent, input.locale);
	if (suggestions) {
		answer.suggestions = suggestions;
	}

	return answer;
}

function buildCodeSection(snippet: CodeContextSnippet) {
	return {
		type: "code" as const,
		title: `${snippet.filePath}:${snippet.focusLine}`,
		body: `${snippet.summary} [${snippet.fileRole}]`,
		language: "text",
		code: snippet.code,
	};
}

export function buildPlainTextFallbackAnswer(rawText: string, locale: ReviewLocale): ReviewStructuredAnswer {
	return buildAnswer({
		locale,
		title: locale === "zh" ? "回复" : "Response",
		type: "text",
		findings: [rawText.trim()],
	});
}

export function buildProjectSummaryAnswer(summary: ProjectSummaryView, locale: ReviewLocale): ReviewStructuredAnswer {
	const title = labels(locale).projectSummary;
	return buildAnswer({
		locale,
		title,
		type: "text",
		summary: locale === "zh"
			? `当前分析覆盖 ${summary.packageCount} 个包，共发现 ${summary.totalIssues} 个问题。`
			: `The current analysis covers ${summary.packageCount} package(s) and found ${summary.totalIssues} issue(s).`,
		metadata: [
			{ key: locale === "zh" ? "项目类型" : "Kind", value: summary.kind },
			{ key: locale === "zh" ? "声明数" : "Declarations", value: String(summary.totalDeclarations) },
			{ key: locale === "zh" ? "引用数" : "References", value: String(summary.totalReferences) },
			{ key: locale === "zh" ? "问题数" : "Issues", value: String(summary.totalIssues) },
		],
		nextActionIntent: ["check_problematic_packages"],
	});
}

export function buildPackageSummaryAnswer(summary: PackageSummaryView, locale: ReviewLocale): ReviewStructuredAnswer {
	return buildAnswer({
		locale,
		title: `${labels(locale).packageSummary}: ${summary.packageName}`,
		type: "text",
		metadata: [
			{ key: locale === "zh" ? "路径" : "Path", value: summary.path },
			{ key: locale === "zh" ? "声明依赖" : "Declared", value: String(summary.declaredDependencies) },
			{ key: locale === "zh" ? "引用依赖" : "Referenced", value: String(summary.referencedDependencies) },
			{ key: locale === "zh" ? "问题数" : "Issues", value: String(summary.issueCount) },
		],
		findings: [
			`${locale === "zh" ? "未使用依赖" : "Unused dependencies"}: ${summary.unusedDependencies.join(", ") || "-"}`,
			`${locale === "zh" ? "幽灵依赖" : "Ghost dependencies"}: ${summary.ghostDependencies.join(", ") || "-"}`,
		],
		nextActionIntent: ["review_unused_dependencies", "review_ghost_dependencies"],
	});
}

export function buildProblematicPackagesAnswer(items: PackageIssueRankingView[], locale: ReviewLocale): ReviewStructuredAnswer {
	return buildAnswer({
		locale,
		title: labels(locale).problematicPackages,
		type: "dependency_list",
		findings: items.map((item) =>
			`${item.packageName}: issues=${item.issueCount}, unused=${item.unusedDependencyCount}, ghost=${item.ghostDependencyCount}, undeclaredWorkspace=${item.undeclaredWorkspaceDependencyCount}`
		),
		nextActionIntent: ["review_unused_dependencies", "review_ghost_dependencies"],
	});
}

export function buildDependencyNameListAnswer(
	title: string,
	summary: string,
	items: string[],
	locale: ReviewLocale,
	nextActionIntent?: ReviewNextStepIntent[]
): ReviewStructuredAnswer {
	const input: AnswerBuildInput = {
		locale,
		title,
		type: "dependency_list",
		summary,
		findings: items.length > 0 ? items : [locale === "zh" ? "没有结果。" : "No results."],
	};
	if (nextActionIntent) {
		input.nextActionIntent = nextActionIntent;
	}
	return buildAnswer(input);
}

export function buildReviewCandidateAnswer(candidate: DependencyReviewCandidate, locale: ReviewLocale): ReviewStructuredAnswer {
	const citations = [
		`${locale === "zh" ? "判定" : "Disposition"}: ${candidate.disposition}`,
		`${locale === "zh" ? "置信度" : "Confidence"}: ${candidate.confidence}`,
		...(typeof candidate.reviewConfidenceScore === "number"
			? [`${locale === "zh" ? "融合分数" : "Fusion score"}: ${candidate.reviewConfidenceScore}`]
			: []),
		`${locale === "zh" ? "信号数" : "Signals"}: ${candidate.signalCount}`,
		...(candidate.reviewEvidence || []),
		...((candidate.reviewConfidenceBreakdown || []).map((item) =>
			`${locale === "zh" ? "融合" : "Fusion"}: ${item}`
		)),
	];

	return buildAnswer({
		locale,
		title: `${labels(locale).reviewCandidate}: ${candidate.dependencyName}`,
		type: "assessment",
		summary: candidate.reason,
		citations,
		nextActionIntent: [
			...(candidate.signals.length > 0 ? ["inspect_context" as const] : []),
			...(candidate.disposition === "needs-review" ? ["review_candidate" as const] : []),
		],
	});
}

export function buildRemovalAssessmentAnswer(assessment: RemovalAssessment, locale: ReviewLocale): ReviewStructuredAnswer {
	return buildAnswer({
		locale,
		title: `${labels(locale).removalAssessment}: ${assessment.dependencyName}`,
		type: "assessment",
		summary: assessment.reason,
		metadata: [
			{ key: locale === "zh" ? "建议移除" : "Recommended", value: String(assessment.recommended) },
			{ key: locale === "zh" ? "置信度" : "Confidence", value: assessment.confidence },
			{ key: locale === "zh" ? "风险级别" : "Risk", value: assessment.riskLevel },
		],
		nextActionIntent: assessment.recommended
			? ["manual_verify_before_remove"]
			: ["inspect_context", "manual_verify_before_remove"],
	});
}

export function buildContextBundleAnswer(bundle: DependencyContextBundle, locale: ReviewLocale): ReviewStructuredAnswer {
	return buildAnswer({
		locale,
		title: `${labels(locale).codeContext}: ${bundle.dependencyName}`,
		type: "code_context",
		summary: locale === "zh"
			? `共收集 ${bundle.snippetCount} 个相关片段。`
			: `Collected ${bundle.snippetCount} related snippet(s).`,
		metadata: [
			{ key: locale === "zh" ? "引用数" : "References", value: String(bundle.referenceCount) },
			{ key: locale === "zh" ? "信号数" : "Signals", value: String(bundle.signalCount) },
		],
		codeSnippets: bundle.snippets,
		nextActionIntent: ["manual_verify_before_remove"],
	});
}
