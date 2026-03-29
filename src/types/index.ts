export interface Dependency {
	name: string;
	type: string;
	version: object;
	usage: boolean;
	isDev: boolean;
	args?: string;
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
	html?: boolean;
	preReview?: boolean;
}

export interface ScannedSourceFile {
	path: string;
	code: string;
	originalCode?: string;
}

export interface Result {
	usedDependencies: number;
	unusedDependencies: Dependency[];
	ununsedDependenciesCount: number;
	totalDependencies: number;
	devDependencies: Dependency[];
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
	filePath: string;
	line: number;
	column: number;
	kind: "import" | "require" | "dynamic-import";
	specifier: string;
	isWorkspaceReference: boolean;
}

export interface IssueEvidence {
	id: string;
	packageName: string;
	dependencyName: string;
	issueType: "unused-dependency" | "ghost-dependency" | "undeclared-workspace-dependency";
	reason: string;
	supportingEvidenceIds: string[];
}

export interface SignalEvidence {
	id: string;
	packageName: string;
	dependencyName: string;
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
	summary: Result | null;
	usedImports: string[];
	declaredDependencies: string[];
	unusedDependencies: string[];
	workspaceDependencies: string[];
	undeclaredWorkspaceDependencies: string[];
	ghostDependencies: string[];
	dynamicUnusedDependencies: string[];
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

export interface LogQueue {
	type: string;
	message: string;
}

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
	reviewNextStep?: string;
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
	title: string;
	locale?: ReviewLocale;
	summary?: string;
	sections: ReviewSection[];
	suggestions?: string[];
}
