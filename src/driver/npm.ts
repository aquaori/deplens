import fs from 'fs';
import { ArgumentsCamelCase } from 'yargs';
import { Dependency } from '../types';
import { satisfies } from 'compare-versions';

/**
 * 获取npm项目的依赖信息
 * @param args 命令行参数对象
 * @param checkCount 检查计数
 * @returns 依赖列表和更新后的检查计数
 */
export async function getNpmDependencies(args: ArgumentsCamelCase<{
    path: string;
    ignoreDep: string;
    config: string;
}>, checkCount: number) {
    // 确定npm依赖锁文件路径
    const manifestPath = `${args.path}/package-lock.json`;
    
    // 检查锁文件是否存在
    if (!fs.existsSync(manifestPath)) {
        const hint = `The ${args.path}/package-lock.json file does not exist, so dependencies cannot be resolved.\n> If your project dependencies are managed by pnpm, please run deplens with the --pnpm or --pn option.`;
        throw new Error(hint);
    }

    // 解析锁文件
    const rootManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    
    // 获取不同类型的依赖
    const rootProd = rootManifest["packages"][""].dependencies || {};
    const rootPeer = rootManifest["packages"][""].peerDependencies || {};
    const rootOpt = rootManifest["packages"][""].optionalDependencies || {};
    const rootDev = rootManifest["packages"][""].devDependencies || {};

    delete rootManifest["packages"][""];
    const depSource = rootManifest["packages"];

    // 收集被其他包使用的依赖
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
    
    // 构建锁文件中的依赖包列表
    const lockFilePkg: Dependency[] = [];
    const rootDeclared = new Map<string, string>();
    Object.entries({ ...rootProd, ...rootPeer, ...rootOpt, ...rootDev })
        .forEach(([name, ver]) => rootDeclared.set(name, ver as string));
    
    for (const [name, version] of rootDeclared) {
        let ignoreList: string[] = [];
        
        // 处理配置文件中指定的忽略依赖
        if (args['config'] !== "" || fs.existsSync(`${args.path}/deplens.config.json`)) {
            const configPath = args['config'] || `${args.path}/deplens.config.json`;
            const config = fs.readFileSync(configPath, 'utf8');
            const ignore = JSON.parse(config).ignoreDep || [];
            ignoreList = [...ignoreList, ...ignore];
        }
        
        // 处理命令行参数中指定的忽略依赖
        if (args['ignoreDep'] !== "") {
            const ignoreListFromArgs = args['ignoreDep'].split(',');
            ignoreList = [...ignoreList, ...ignoreListFromArgs];
        }
        
        if (ignoreList.includes(name)) continue;

        // 获取纯净版本号
        const pureVersion = version.replace(/[\^\*\~\=\>\<]/g, '');
        
        // 处理使用的版本列表
        const usedVersions = usedByOthers.get(name);
        const usedVersionsList = new Set<string>();
        
        for (let ver of usedVersions || []) {
            const verList = ver ? ver.split(" || ") : [];
            for (let ver of verList) {
                const verName = ver;
                if (verName != "") usedVersionsList.add(verName);
            }
        }
        
        // 检查依赖是否被使用
        let isUsed = usedVersionsList.has(pureVersion);
        
        for (let ver of usedVersionsList) {
            if (ver == "*") {
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

            const previousPkgIndex = lockFilePkg.findIndex(dep => dep.name == name);
            const previousPkg = previousPkgIndex >= 0 ? lockFilePkg[previousPkgIndex] : null;
            let previousVersion = (previousPkg as any)?.version ?? [];
            
            if (previousPkg !== null && previousVersion !== "") {
                if (previousVersion.length != 0 && !previousPkg?.usage) {
                    previousVersion = [...previousVersion, preciseVersion];
                } else {
                    previousVersion = [preciseVersion];
                }
            } else {
                previousVersion = [preciseVersion];
            }
            
            if (previousVersion.length != 1) {
                previousVersion = [previousVersion.join(" & @")];
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

    // 按名称排序
    lockFilePkg.sort((a, b) => a.name.localeCompare(b.name));
    return [lockFilePkg, checkCount];
}
