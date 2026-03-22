import * as babel from '@babel/core';

const suppressedStderrPatterns = [
	/\[baseline-browser-mapping]/,
	/The exported identifier "global" is not declared in Babel's scope tracker/,
	/It will be treated as a JavaScript value\./,
	/This problem is likely caused by another plugin injecting/,
	/please use "scope\.registerDeclaration\(declarationPath\)"/
];

function shouldSuppressStderr(message: string): boolean {
	return suppressedStderrPatterns.some((pattern) => pattern.test(message));
}

function shouldRetryWithDeprecatedImportAssert(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.message.includes("deprecatedImportAssert")
		|| error.message.includes("assert keyword in import attributes is deprecated")
		|| error.message.includes("has been replaced by the `with` keyword");
}

function buildParserPlugins(useDeprecatedImportAssert: boolean) {
	return [
		useDeprecatedImportAssert ? 'deprecatedImportAssert' : 'importAttributes',
		'jsx',
		'typescript',
	] as any;
}

function withSuppressedTranspileNoise<T>(runner: () => T): T {
	const originalWarn = console.warn;
	const originalError = console.error;
	const originalStderrWrite = process.stderr.write.bind(process.stderr);
	let stderrBuffer = '';

	const flushStderr = (chunk: string, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
		stderrBuffer += chunk;
		const lines = stderrBuffer.split(/\r?\n/);
		stderrBuffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!shouldSuppressStderr(line)) {
				originalStderrWrite(`${line}\n`, encoding, callback);
			}
		}
		return true;
	};

	console.warn = (...args: unknown[]) => {
		const message = args.map((arg) => String(arg)).join(' ');
		if (!shouldSuppressStderr(message)) {
			originalWarn(...args);
		}
	};

	console.error = (...args: unknown[]) => {
		const message = args.map((arg) => String(arg)).join(' ');
		if (!shouldSuppressStderr(message)) {
			originalError(...args);
		}
	};

	process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
		const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
		const resolvedEncoding = typeof encoding === 'string' ? encoding : undefined;
		const resolvedCallback = typeof encoding === 'function' ? encoding : callback;
		return flushStderr(text, resolvedEncoding, resolvedCallback);
	}) as typeof process.stderr.write;

	try {
		return runner();
	} finally {
		if (stderrBuffer.trim() !== '' && !shouldSuppressStderr(stderrBuffer.trim())) {
			originalStderrWrite(stderrBuffer);
		}
		console.warn = originalWarn;
		console.error = originalError;
		process.stderr.write = originalStderrWrite as typeof process.stderr.write;
	}
}

export async function transpileToStandardJS(sourceCode: any, rootPath: string, filename = 'source.js') {
	const path = require('path');
	const __dirname = path.dirname(require.main?.filename ?? process.argv[1]);
	const resolvePlugin = (name: string) => {
		return require.resolve(name, { paths: [__dirname] });
	};
	const sep = process.platform === 'win32' ? '\\' : '/';
	const fullPath = rootPath + sep + filename;
	const transformWithParserMode = (useDeprecatedImportAssert: boolean) =>
		withSuppressedTranspileNoise(() => babel.transformSync(sourceCode, {
			filename: fullPath,
			parserOpts: {
				plugins: buildParserPlugins(useDeprecatedImportAssert),
			},
			presets: [
				[resolvePlugin('@babel/preset-typescript'), {
					allExtensions: true,
					isTSX: true
				}],
				[resolvePlugin('@babel/preset-react'), {
					runtime: 'automatic',
				}]
			],
			plugins: [
				[resolvePlugin('@babel/plugin-syntax-import-assertions'), useDeprecatedImportAssert ? {
					deprecatedAssertSyntax: true,
				} : {}],
				[resolvePlugin('@babel/plugin-syntax-top-level-await'), {}],
			],
			ast: false,
			sourceMaps: false,
			configFile: false,
			babelrc: false,
		}));

	let result;
	try {
		result = transformWithParserMode(false);
	} catch (error) {
		if (!shouldRetryWithDeprecatedImportAssert(error)) {
			throw error;
		}
		result = transformWithParserMode(true);
	}

	if (!result || !result.code) {
		throw new Error('Babel transpilation failed');
	}

	return result.code;
}
