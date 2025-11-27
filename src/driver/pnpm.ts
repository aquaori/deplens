import fs from 'fs';
import yaml from 'js-yaml';
import { ArgumentsCamelCase } from 'yargs';
import { Dependency } from '../types';

/**
 * 获取pnpm项目的依赖信息
 * @param args 命令行参数对象
 * @param checkCount 检查计数
 * @returns 依赖列表和更新后的检查计数
 */
export async function getPnpmDependencies(args: ArgumentsCamelCase<{
    path: string;
    ignoreDep: string;
    config: string;
}>, checkCount: number) {
    // 确定pnpm依赖锁文件路径
    const manifestPath = `${args.path}/pnpm-lock.yaml`;
    
    // 检查锁文件是否存在
    if (!fs.existsSync(manifestPath)) {
        const hint = `The ${args.path}/pnpm-lock.yaml file does not exist, so dependencies cannot be resolved.\n> If your project dependencies are managed by npm, please run deplens without the --pnpm or --pn option.`;
        throw new Error(hint);
    }

    // 解析锁文件
    const rootManifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as any;
    
    // 获取pnpm锁文件版本
    const lockVersion = rootManifest.lockfileVersion as number;
    
    // 获取不同类型的依赖
    const rootProd = lockVersion == 6 
        ? rootManifest.dependencies || {} 
        : rootManifest['importers']['.']?.dependencies || {};
    const rootPeer = lockVersion == 6 
        ? rootManifest.peerDependencies || {} 
        : rootManifest['importers']['.']?.peerDependencies || {};
    const rootOpt = lockVersion == 6 
        ? rootManifest.optionalDependencies || {} 
        : rootManifest['importers']['.']?.optionalDependencies || {};
    const rootDev = lockVersion == 6 
        ? rootManifest.devDependencies || {} 
        : rootManifest['importers']['.']?.devDependencies || {};

    const depSource = lockVersion == 6 
        ? rootManifest.packages || {} 
        : rootManifest.snapshots || {};

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
        const pureVersion = (version as any).version.replace(/\(.+?\)+/g, '');
        
        // 处理使用的版本列表
        const usedVersions = usedByOthers.get(name);
        const usedVersionsList = usedVersions || new Set<string>();
        
        // 检查依赖是否被使用
        const isUsed = usedVersionsList.has(pureVersion);

        if (!isUsed) {
            let preciseVersion: string = "0";
            if (typeof version == "string") {
                preciseVersion = version.replace(/\(.+?\)+/g, '');
            } else if (typeof version == "object") {
                preciseVersion = (version as any).version.replace(/\(.+?\)+/g, '');
            }

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
