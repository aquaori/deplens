import fs from 'fs';
import yaml from 'js-yaml';
import { ArgumentsCamelCase } from 'yargs';
import { Dependency } from '../types';
import { resolvePackageManager } from './package-manager';

export async function getPnpmDependencies(args: ArgumentsCamelCase<{
	path: string;
	ignoreDep: string;
	config: string;
}>, checkCount: number) {
	const resolution = resolvePackageManager(args.path);
	if (resolution.manager !== 'pnpm') {
		throw new Error(`Resolved package manager is ${resolution.manager}, not pnpm.`);
	}

	if (!fs.existsSync(resolution.lockfilePath)) {
		throw new Error(
			`The ${resolution.lockfilePath} file does not exist, so dependencies cannot be resolved.`
		);
	}

	const rootManifest = yaml.load(fs.readFileSync(resolution.lockfilePath, 'utf-8')) as any;
	const lockVersion = rootManifest.lockfileVersion as number;
	const importerKey = resolution.importerKey;

	const importer = lockVersion === 6
		? rootManifest
		: rootManifest['importers']?.[importerKey];

	if (!importer || typeof importer !== 'object') {
		throw new Error(
			`The importer ${importerKey} was not found in ${resolution.lockfilePath}.`
		);
	}

	const rootProd = importer.dependencies || {};
	const rootPeer = importer.peerDependencies || {};
	const rootOpt = importer.optionalDependencies || {};
	const rootDev = importer.devDependencies || {};

	const depSource = lockVersion === 6
		? rootManifest.packages || {}
		: rootManifest.snapshots || {};

	const usedByOthers = new Map<string, Set<string>>();
	for (const [key, pkg] of Object.entries(depSource)) {
		if (key === '' || !pkg || typeof pkg !== 'object') continue;
		const p = pkg as any;
		[
			p.dependencies || {},
			p.peerDependencies || {},
			p.optionalDependencies || {}
		].forEach(obj => {
			Object.entries(obj).forEach(([depName, depRange]) => {
				if (typeof depRange !== 'string') return;
				const ver = depRange.replace(/\(.+?\)+/g, '');
				if (!usedByOthers.has(depName)) usedByOthers.set(depName, new Set());
				usedByOthers.get(depName)!.add(ver);
				checkCount++;
			});
		});
	}

	const lockFilePkg: Dependency[] = [];
	const rootDeclared = new Map<string, string | { version: string }>();
	Object.entries({ ...rootProd, ...rootPeer, ...rootOpt, ...rootDev })
		.forEach(([name, ver]) => rootDeclared.set(name, ver as string | { version: string }));

	for (const [name, version] of rootDeclared) {
		let ignoreList: string[] = [];

		if (args['config'] !== '' || fs.existsSync(`${args.path}/deplens.config.json`)) {
			const configPath = args['config'] || `${args.path}/deplens.config.json`;
			const config = fs.readFileSync(configPath, 'utf8');
			const ignore = JSON.parse(config).ignoreDep || [];
			ignoreList = [...ignoreList, ...ignore];
		}

		if (args['ignoreDep'] !== '') {
			const ignoreListFromArgs = args['ignoreDep'].split(',');
			ignoreList = [...ignoreList, ...ignoreListFromArgs];
		}

		if (ignoreList.includes(name)) continue;

		const versionString = typeof version === 'string' ? version : version.version;
		const pureVersion = versionString.replace(/\(.+?\)+/g, '');
		const usedVersions = usedByOthers.get(name);
		const usedVersionsList = usedVersions || new Set<string>();
		const isUsed = usedVersionsList.has(pureVersion);

		if (!isUsed) {
			const preciseVersion = versionString.replace(/\(.+?\)+/g, '');
			const previousPkgIndex = lockFilePkg.findIndex(dep => dep.name === name);
			const previousPkg = previousPkgIndex >= 0 ? lockFilePkg[previousPkgIndex] : null;
			let previousVersion = (previousPkg as any)?.version ?? [];

			if (previousPkg !== null && previousVersion !== '') {
				if (previousVersion.length !== 0 && !previousPkg?.usage) {
					previousVersion = [...previousVersion, preciseVersion];
				} else {
					previousVersion = [preciseVersion];
				}
			} else {
				previousVersion = [preciseVersion];
			}

			if (previousVersion.length !== 1) {
				previousVersion = [previousVersion.join(' & @')];
			}

			if (previousPkgIndex >= 0 && previousPkg !== null) {
				(lockFilePkg as any)[previousPkgIndex].version = previousVersion;
			} else {
				lockFilePkg.push({
					name,
					type: '',
					version: previousVersion,
					usage: isUsed,
					isDev: Object.prototype.hasOwnProperty.call(rootDev, name)
				});
			}
		}
	}

	lockFilePkg.sort((a, b) => a.name.localeCompare(b.name));
	return [lockFilePkg, checkCount];
}
