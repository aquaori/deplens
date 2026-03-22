// 主导出文件
// 重新导出所有需要的函数和类型

export { analyzeProject, displayResults } from './analyzer';
export {
	buildMonorepoEvidenceIndex,
	buildPackageEvidenceChain,
	explainDependencyEvidence,
	findDependencyDeclarations,
	findDependencyReferences,
	findDependencySignals,
	findIssueEvidence,
} from './evidence';
export {
	canRemoveDependency,
	getDependencyContextBundle,
	getDependencyOverview,
	getGhostDependencies,
	getPackageNames,
	getDependencyReviewCandidate,
	getDependencyReviewCandidates,
	getProblematicPackages,
	getPackageSummary,
	getProjectSummary,
	getUnusedDependencies,
} from './query';
export type { Dependency, Result } from './types';
