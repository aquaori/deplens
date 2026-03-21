import fs from 'fs';
import { ArgumentsCamelCase } from 'yargs';
import { Dependency } from '../types';
import { satisfies } from 'compare-versions';
import { resolvePackageManager } from './package-manager';

export async function getNpmDependencies(args: ArgumentsCamelCase<{
	path: string;
	ignoreDep: string;
	config: string;
}>, checkCount: number) {
	const resolution = resolvePackageManager(args.path);
	if (resolution.manager !== 'npm') {
		throw new Error(`Resolved package manager is ${resolution.manager}, not npm.`);
	}

	if (!fs.existsSync(resolution.lockfilePath)) {
		throw new Error(
			`The ${resolution.lockfilePath} file does not exist, so dependencies cannot be resolved.`
		);
	}

	const rootManifest = JSON.parse(fs.readFileSync(resolution.lockfilePath, 'utf-8'));
	const importerKey = resolution.importerKey === '.' ? '' : resolution.importerKey;
	const importer = rootManifest['packages']?.[importerKey];

	if (!importer || typeof importer !== 'object') {
		throw new Error(
			`The importer ${resolution.importerKey} was not found in ${resolution.lockfilePath}.`
		);
	}

	const rootProd = importer.dependencies || {};
	const rootPeer = importer.peerDependencies || {};
	const rootOpt = importer.optionalDependencies || {};
	const rootDev = importer.devDependencies || {};

	const depSource = { ...(rootManifest['packages'] || {}) };
	delete depSource[importerKey];

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
	const rootDeclared = new Map<string, string>();
	Object.entries({ ...rootProd, ...rootPeer, ...rootOpt, ...rootDev })
		.forEach(([name, ver]) => rootDeclared.set(name, ver as string));

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

		const pureVersion = version.replace(/[\^\*\~\=\>\<]/g, '');
		const usedVersions = usedByOthers.get(name);
		const usedVersionsList = new Set<string>();

		for (const ver of usedVersions || []) {
			const verList = ver ? ver.split(' || ') : [];
			for (const versionRange of verList) {
				if (versionRange !== '') usedVersionsList.add(versionRange);
			}
		}

		let isUsed = usedVersionsList.has(pureVersion);

		for (const ver of usedVersionsList) {
			if (ver === '*') {
				isUsed = true;
				break;
			}
			if (satisfies(pureVersion, ver)) {
				isUsed = true;
				break;
			}
		}

		if (!isUsed) {
			const preciseVersion = version.replace(/\(.+?\)+/g, '');
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
