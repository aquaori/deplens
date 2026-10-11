export type ManifestSection =
	| "dependencies"
	| "devDependencies"
	| "peerDependencies"
	| "optionalDependencies";

/** lockfile 中「另一个已安装的包」对某依赖的依赖声明。 */
export interface TransitiveRequirement {
	package: string;
	section: ManifestSection;
	range: string;
}

export interface DeclaredDependency {
	name: string;
	section: ManifestSection;
	range: string;
	requiredBy: TransitiveRequirement[];
}

export interface LockfileGraph {
	manager: "npm" | "pnpm";
	lockfilePath: string;
	importerKey: string;
	declared: DeclaredDependency[];
	transitiveEdgeCount: number;
}

/**
 * 未被源码引用的依赖的处置分类。
 *
 * 判断的对象始终是「package.json 里的这一行声明」，而不是「node_modules 里的这个包」：
 * 删掉声明不会卸载仍被其它已安装包依赖的包，因此 still-installed 反而是零风险的。
 */
export type UnusedDependencyClass =
	/** 没有任何其它包依赖它，移除声明后会真正从依赖树中消失。 */
	| "unused-orphan"
	/** 仍被其它已安装包以 dependencies/optionalDependencies 依赖，移除声明零风险。 */
	| "unused-still-installed"
	/** 声明的版本不被部分依赖方接受，移除会改变依赖树的版本收敛，需要确认。 */
	| "unused-version-pin"
	/** 被其它已安装包以 peerDependencies 要求，通常必须由本项目声明，不建议移除。 */
	| "keep-peer-requirement"
	/** lockfile 不可用，无法判断传递依赖和版本收敛风险。 */
	| "risk-unknown";

export interface Dependency {
	name: string;
	type: string;
	version: string[];
	usage: boolean;
	isDev: boolean;
	section?: ManifestSection;
	requiredBy?: TransitiveRequirement[];
	unusedClass?: UnusedDependencyClass;
	/**
	 * 被判定为「已使用」的依据：
	 *  - source: 源码中有静态引用
	 *  - script: 作为命令出现在 package.json scripts 中
	 *  - types-companion: `@types/x` 且对应的 x 被使用或声明（由 TypeScript 隐式消费）
	 */
	usageKind?: "source" | "script" | "types-companion";
	/** 引用只出现在类型位置（`import type` 等），运行时可能并不需要它。 */
	isTypeOnlyUsage?: boolean;
}

/** 无法静态解析的 `import(expr)` / `require(expr)`。 */
export interface DynamicSpecifierRecord {
	filePath: string;
	line: number;
	kind: "import" | "require";
	expression: string;
}

export interface AnalysisCliArgs {
	path: string;
	verbose: boolean;
	silence: boolean;
	ignoreDep: string;
	ignorePath: string;
	ignoreFile: string;
	config: string;
	json: boolean;
	output: string;
	review?: boolean;
}

export interface SourceBlock {
	code: string;
	/** 该块在原文件中的起始行偏移，用于让 .vue 的证据行号指回 SFC 本身。 */
	lineOffset: number;
}

export interface ScannedSourceFile {
	path: string;
	absolutePath: string;
	originalCode: string;
	blocks: SourceBlock[];
}

export interface ScanError {
	path: string;
	message: string;
}

export interface ScanResult {
	files: ScannedSourceFile[];
	errors: ScanError[];
}

export interface ParsedSourceBlock {
	file: ScannedSourceFile;
	ast: any;
	code: string;
	lineOffset: number;
}

export interface Result {
	usedDependencies: number;
	unusedDependencies: Dependency[];
	unusedDependenciesCount: number;
	/** @deprecated 历史拼写错误的字段，保留以兼容既有 JSON 消费方，将在下个大版本移除。 */
	ununsedDependenciesCount: number;
	/** 本包在 package.json 中声明的依赖总数。 */
	totalDependencies: number;
	/** lockfile 中所有已安装包之间的依赖边数量（旧版本曾被错误地当作 totalDependencies）。 */
	transitiveEdgeCount: number;
	/** 已声明但未被源码引用的 devDependencies。 */
	devDependencies: Dependency[];
	/** 声明在运行时依赖中、但只被类型位置引用的依赖（通常应移到 devDependencies）。 */
	typeOnlyDependencies: Dependency[];
	/** 无法静态解析的动态导入。 */
	dynamicImports: DynamicSpecifierRecord[];
	/** lockfile 解析状态。未解析时所有移除风险均为未知。 */
	lockfile: {
		resolved: boolean;
		manager?: "npm" | "pnpm";
		path?: string;
		reason?: string;
	};
	/** 扫描或解析不完整时保留结构化错误，避免把部分结果当成完整结果。 */
	scanErrors?: ScanError[];
}

export interface DeclarationEvidence {
	id: string;
	packageName: string;
	dependencyName: string;
	manifestPath: string;
	section: "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
	versionRange: string;
}

export interface ReferenceEvidence {
	id: string;
	packageName: string;
	dependencyName: string;
	/** 相对包根目录的路径。读取文件时用 report 的包根解析，避免把本机绝对路径写进 JSON 报告。 */
	filePath: string;
	line: number;
	column: number;
	kind: "import" | "require" | "dynamic-import" | "re-export";
	specifier: string;
	isTypeOnly: boolean;
	isWorkspaceReference: boolean;
}

export interface IssueEvidence {
	id: string;
	packageName: string;
	dependencyName: string;
	issueType:
		| "unused-dependency"
		| "ghost-dependency"
		| "undeclared-workspace-dependency"
		| "type-only-dependency";
	reason: string;
	supportingEvidenceIds: string[];
	/** unused-dependency 的移除风险分级。 */
	dependencyClass?: UnusedDependencyClass;
}

export interface SignalEvidence {
	id: string;
	packageName: string;
	dependencyName: string;
	/** 相对包根目录的路径。 */
	filePath: string;
	line: number;
	column: number;
	signalType: "string-literal" | "tooling-string" | "require-resolve" | "script-command";
	fileRole: "source" | "config" | "tooling" | "script" | "test";
	value: string;
}

export interface CodeContextSnippet {
	filePath: string;
	lineStart: number;
	lineEnd: number;
	focusLine: number;
	origin: "signal" | "reference";
	fileRole: SignalEvidence["fileRole"] | "reference";
	summary: string;
	code: string;
}

export interface DependencyContextBundle {
	dependencyName: string;
	packageName?: string;
	snippetCount: number;
	signalCount: number;
	referenceCount: number;
	snippets: CodeContextSnippet[];
}

export interface PackageEvidenceChain {
	declarations: DeclarationEvidence[];
	references: ReferenceEvidence[];
	issues: IssueEvidence[];
	signals: SignalEvidence[];
}

export interface MonorepoEvidenceIndex {
	packages: string[];
	declarations: DeclarationEvidence[];
	references: ReferenceEvidence[];
	issues: IssueEvidence[];
	signals: SignalEvidence[];
	declarationsByDependency: Record<string, DeclarationEvidence[]>;
	referencesByDependency: Record<string, ReferenceEvidence[]>;
	issuesByDependency: Record<string, IssueEvidence[]>;
	signalsByDependency: Record<string, SignalEvidence[]>;
	declarationsByPackage: Record<string, DeclarationEvidence[]>;
	referencesByPackage: Record<string, ReferenceEvidence[]>;
	issuesByPackage: Record<string, IssueEvidence[]>;
	signalsByPackage: Record<string, SignalEvidence[]>;
}

export interface MonorepoPackageAnalysisReport {
	name: string;
	path: string;
	summary: Result;
	usedImports: string[];
	declaredDependencies: string[];
	/** 全部未被源码引用的运行时依赖（含需要人工确认的分类）。 */
	unusedDependencies: string[];
	/** 其中建议直接移除声明的部分。 */
	removableDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	dynamicImports: DynamicSpecifierRecord[];
	evidence: PackageEvidenceChain;
}

export interface SingleProjectAnalysisReport {
	kind: "project";
	path: string;
	summary: Result;
	evidence: PackageEvidenceChain;
}

export interface MonorepoAnalysisReport {
	kind: "monorepo";
	projectPath: string;
	monorepoType: "npm" | "pnpm" | "unknown";
	packageCount: number;
	packagesWithUnusedDependencies: number;
	packagesWithGhostDependencies: number;
	packagesWithoutUnusedDependencies: number;
	packages: MonorepoPackageAnalysisReport[];
	evidenceIndex: MonorepoEvidenceIndex;
}

export type AnalysisReport = SingleProjectAnalysisReport | MonorepoAnalysisReport;


export interface ProjectSummaryView {
	kind: "project" | "monorepo";
	projectPath: string;
	packageCount: number;
	packagesWithUnusedDependencies: number;
	packagesWithGhostDependencies: number;
	totalDeclarations: number;
	totalReferences: number;
	totalIssues: number;
	monorepoType?: "npm" | "pnpm" | "unknown";
}

export interface PackageSummaryView {
	packageName: string;
	path: string;
	declaredDependencies: number;
	referencedDependencies: number;
	unusedDependencies: string[];
	ghostDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	issueCount: number;
}

export interface PackageIssueRankingView {
	packageName: string;
	path: string;
	issueCount: number;
	unusedDependencyCount: number;
	ghostDependencyCount: number;
	undeclaredWorkspaceDependencyCount: number;
}

export interface DependencyOverview {
	dependencyName: string;
	packageName?: string;
	declarations: DeclarationEvidence[];
	references: ReferenceEvidence[];
	issues: IssueEvidence[];
	signals: SignalEvidence[];
	isDeclared: boolean;
	isReferenced: boolean;
	hasSignals: boolean;
	isGhostDependency: boolean;
	isUnusedDependency: boolean;
	isUndeclaredWorkspaceDependency: boolean;
	referencedByPackages: string[];
	referencedFiles: string[];
}

export interface RemovalAssessment {
	dependencyName: string;
	packageName?: string;
	recommended: boolean;
	confidence: "low" | "medium" | "high";
	riskLevel: "low" | "medium" | "high";
	reason: string;
	declarations: DeclarationEvidence[];
	references: ReferenceEvidence[];
	issues: IssueEvidence[];
}

export type DependencyReviewDisposition =
	| "confirmed-used"
	| "high-confidence-unused"
	| "likely-tooling-usage"
	| "needs-review"
	| "ghost-dependency";

export interface DependencyReviewCandidate {
	dependencyName: string;
	packageName?: string;
	disposition: DependencyReviewDisposition;
	originalDisposition?: DependencyReviewDisposition;
	confidence: "low" | "medium" | "high";
	reason: string;
	isDeclared: boolean;
	isReferenced: boolean;
	isUnusedDependency: boolean;
	isGhostDependency: boolean;
	signalCount: number;
	signalTypes: SignalEvidence["signalType"][];
	signalFileRoles: SignalEvidence["fileRole"][];
	declarations: DeclarationEvidence[];
	references: ReferenceEvidence[];
	issues: IssueEvidence[];
	signals: SignalEvidence[];
	reviewedByAgent?: boolean;
	reviewEvidence?: string[];
	reviewEvidenceIds?: string[];
	reviewNextStep?: string;
	reviewParseStatus?: "ok" | "missing-marker" | "invalid-json" | "invalid-schema";
	reviewFallbackUsed?: boolean;
	reviewConfidenceScore?: number;
	reviewConfidenceBreakdown?: string[];
	reviewRounds?: number;
	reviewDecision?: ReviewDecisionMetadata;
}

export interface ReviewDecisionMetadata {
	provider: "llm" | "jev";
	model?: string;
	probabilities?: Partial<Record<DependencyReviewDisposition, number>>;
	confidence?: number;
	actionDecisions?: Array<{
		action: ReviewInvestigationActionName;
		probabilities: Partial<Record<ReviewInvestigationActionName, number>>;
		confidence: number;
	}>;
	evidenceDecisions?: Array<{
		id: string;
		role: string;
		probabilities: Record<string, number>;
		confidence: number;
	}>;
	elapsedMs: number;
	callCount: number;
	inputTokens: number;
	outputTokens: number;
	apiStatus?: number;
	fallbackReason?: "api-error" | "invalid-response" | "low-confidence" | "insufficient-evidence" | "unresolved-gaps" | "business-conflict";
}

export type ReviewNextStepIntent =
	| "inspect_context"
	| "review_candidate"
	| "ask_dependency_name"
	| "manual_verify_before_remove"
	| "check_problematic_packages"
	| "review_unused_dependencies"
	| "review_ghost_dependencies";

export type ReviewInvestigationActionName =
	| "inspect_summary"
	| "inspect_scripts"
	| "inspect_config"
	| "inspect_code_context"
	| "search_project_knowledge"
	| "finalize_review";

export interface ReviewInvestigationActionDraft {
	action: ReviewInvestigationActionName;
	reason: string;
}

// 下面两个 draft 类型直接对应 draft-parser 里的 zod schema 推断结果，
// 在 exactOptionalPropertyTypes 下必须显式允许 undefined，否则无法承接 safeParse 的输出。
export interface ReviewVerdictDraft {
	verdict: DependencyReviewDisposition;
	confidence: "low" | "medium" | "high";
	reason: string;
	evidenceNotes?: string[] | undefined;
	evidenceIds?: string[] | undefined;
	nextStepIntent?: ReviewNextStepIntent | undefined;
}

export interface ReviewNarrativeDraft {
	summary: string;
	title?: string | undefined;
	findings?: string[] | undefined;
	citations?: string[] | undefined;
	nextActionIntent?: ReviewNextStepIntent[] | undefined;
	displayStyle?: "compact" | "standard" | "analysis" | undefined;
	accentTone?: "neutral" | "info" | "success" | "warning" | "muted" | undefined;
}

export type FallbackReason =
	| "missing-marker"
	| "invalid-json"
	| "invalid-schema"
	| "plain-text-fallback"
	| "deterministic-summary-fallback"
	| "candidate-default-fallback";

export interface AnswerBuildInput {
	locale: ReviewLocale;
	title?: string;
	type: ReviewResponseType;
	summary?: string;
	findings?: string[];
	citations?: string[];
	codeSnippets?: CodeContextSnippet[];
	metadata?: ReviewKeyValueItem[];
	nextActionIntent?: ReviewNextStepIntent[];
	displayStyle?: "compact" | "standard" | "analysis";
	accentTone?: "neutral" | "info" | "success" | "warning" | "muted";
}

export interface AgentProjectConfig {
	output: {
		strictValidation: boolean;
	};
	memory: {
		enabled: boolean;
		maxEntries: number;
	};
	review: {
		provider?: "llm" | "jev";
		maxRounds: number;
		knowledge: {
			enabled: boolean;
			maxHits: number;
		};
		confidence: {
			staticWeight: number;
			modelWeight: number;
			knowledgeWeight: number;
			conservativeMargin: number;
		};
	};
	telemetry: {
		enabled: boolean;
		maxRuns: number;
	};
}

export interface AgentMemoryEntry {
	id: string;
	createdAt: string;
	updatedAt: string;
	projectPath: string;
	dependencyName?: string;
	packageName?: string;
	disposition?: DependencyReviewDisposition;
	confidence?: "low" | "medium" | "high";
	issueTypes?: IssueEvidence["issueType"][];
	signalTypes?: SignalEvidence["signalType"][];
	filePaths?: string[];
	evidenceIds?: string[];
	parseStatus?: DependencyReviewCandidate["reviewParseStatus"];
	fallbackReason?: FallbackReason;
	deepAnalysisUsed?: boolean;
	useCount: number;
	decayWeight: number;
}

export interface AgentMemoryStore {
	version: 1;
	entries: AgentMemoryEntry[];
}

export interface AgentMemoryHit {
	entry: AgentMemoryEntry;
	score: number;
	matchedFields: string[];
}

export interface AgentRunSummaryEntry {
	id: string;
	createdAt: string;
	projectPath: string;
	dependencyName?: string;
	packageName?: string;
	originalDisposition?: DependencyReviewDisposition;
	finalDisposition?: DependencyReviewDisposition;
	finalConfidence?: "low" | "medium" | "high";
	finalScore?: number;
	reviewRounds?: number;
	parseStatus?: DependencyReviewCandidate["reviewParseStatus"];
	fallbackUsed?: boolean;
	memoryUsed?: boolean;
	knowledgeHitCount?: number;
	validEvidenceCount?: number;
	confidenceBreakdown?: string[];
	decision?: ReviewDecisionMetadata;
}

export interface AgentRunSummaryStore {
	version: 1;
	entries: AgentRunSummaryEntry[];
}

export type ReviewEvidenceSourceType =
	| "declaration"
	| "reference"
	| "issue"
	| "signal"
	| "context"
	| "knowledge"
	| "memory";

export interface ReviewEvidenceRecord {
	id: string;
	kind: "fact" | "claim";
	sourceType: ReviewEvidenceSourceType;
	summary: string;
	content?: string;
	filePath?: string;
	line?: number;
	evidenceIds?: string[];
	freshnessScore?: number;
}

export interface EvidenceGap {
	id: string;
	action: ReviewInvestigationActionName;
	description: string;
	resolved: boolean;
}

export interface ProjectKnowledgeChunk {
	id: string;
	filePath: string;
	title: string;
	text: string;
	hash: string;
	updatedAt: string;
	indexedAt: string;
	tags: string[];
}

export interface ProjectKnowledgeFileIndex {
	filePath: string;
	hash: string;
	updatedAt: string;
	indexedAt: string;
	chunks: ProjectKnowledgeChunk[];
}

export interface ProjectKnowledgeStore {
	version: 1;
	files: ProjectKnowledgeFileIndex[];
}

export interface ProjectKnowledgeHit {
	chunk: ProjectKnowledgeChunk;
	score: number;
	matchedFields: string[];
}

export interface ConfidenceFusionInput {
	candidate: DependencyReviewCandidate;
	modelVerdict?: ReviewVerdictDraft;
	modelDistribution?: Record<DependencyReviewDisposition, number>;
	validEvidenceIds: string[];
	knowledgeHits: ProjectKnowledgeHit[];
	knowledgeEvidenceIds: string[];
	staticWeight?: number;
	modelWeight?: number;
	knowledgeWeight?: number;
	conservativeMargin?: number;
}

export interface ConfidenceFusionResult {
	verdict: DependencyReviewDisposition;
	confidence: "low" | "medium" | "high";
	score: number;
	distribution: Record<DependencyReviewDisposition, number>;
	breakdown: string[];
}

export type ReviewSectionType =
	| "paragraph"
	| "bullet_list"
	| "numbered_list"
	| "kv_list"
	| "code";

export interface ReviewKeyValueItem {
	key: string;
	value: string;
}

export interface ReviewSection {
	type: ReviewSectionType;
	title?: string;
	body?: string;
	items?: string[];
	pairs?: ReviewKeyValueItem[];
	language?: string;
	code?: string;
}

export type ReviewResponseType =
	| "text"
	| "dependency_list"
	| "plan"
	| "assessment"
	| "code_context";

export type ReviewLocale = "zh" | "en";

export interface ReviewStructuredAnswer {
	type: ReviewResponseType;
	title?: string;
	locale?: ReviewLocale;
	summary?: string;
	sections: ReviewSection[];
	suggestions?: string[];
	displayStyle?: "compact" | "standard" | "analysis";
	accentTone?: "neutral" | "info" | "success" | "warning" | "muted";
}
