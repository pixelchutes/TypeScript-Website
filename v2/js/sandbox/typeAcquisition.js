var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
define(["require", "exports", "./vendor/lzstring.min"], function (require, exports, lzstring_min_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    lzstring_min_1 = __importDefault(lzstring_min_1);
    const globalishObj = typeof globalThis !== 'undefined' ? globalThis : window || {};
    globalishObj.typeDefinitions = {};
    /**
     * Type Defs we've already got, and nulls when something has failed.
     * This is to make sure that it doesn't infinite loop.
     */
    exports.acquiredTypeDefs = globalishObj.typeDefinitions;
    const moduleJSONURL = (name) => 
    // prettier-ignore
    `https://ofcncog2cu-dsn.algolia.net/1/indexes/npm-search/${encodeURIComponent(name)}?attributes=types&x-algolia-agent=Algolia%20for%20vanilla%20JavaScript%20(lite)%203.27.1&x-algolia-application-id=OFCNCOG2CU&x-algolia-api-key=f54e21fa3a2a0160595bb058179bfb1e`;
    const unpkgURL = (name, path) => `https://www.unpkg.com/${encodeURIComponent(name)}/${encodeURIComponent(path)}`;
    const packageJSONURL = (name) => unpkgURL(name, 'package.json');
    const errorMsg = (msg, response, config) => {
        config.logger.error(`${msg} - will not try again in this session`, response.status, response.statusText, response);
        debugger;
    };
    /**
     * Grab any import/requires from inside the code and make a list of
     * its dependencies
     */
    const parseFileForModuleReferences = (sourceCode) => {
        // https://regex101.com/r/Jxa3KX/4
        const requirePattern = /(const|let|var)(.|\n)*? require\(('|")(.*)('|")\);?$/;
        // this handle ths 'from' imports  https://regex101.com/r/hdEpzO/4
        const es6Pattern = /(import|export)((?!from)(?!require)(.|\n))*?(from|require\()\s?('|")(.*)('|")\)?;?$/gm;
        // https://regex101.com/r/hdEpzO/6
        const es6ImportOnly = /import\s?('|")(.*)('|")\)?;?/gm;
        const foundModules = new Set();
        var match;
        while ((match = es6Pattern.exec(sourceCode)) !== null) {
            if (match[6])
                foundModules.add(match[6]);
        }
        while ((match = requirePattern.exec(sourceCode)) !== null) {
            if (match[5])
                foundModules.add(match[5]);
        }
        while ((match = es6ImportOnly.exec(sourceCode)) !== null) {
            if (match[2])
                foundModules.add(match[2]);
        }
        return Array.from(foundModules);
    };
    /** Converts some of the known global imports to node so that we grab the right info */
    const mapModuleNameToModule = (name) => {
        // in node repl:
        // > require("module").builtinModules
        const builtInNodeMods = [
            'assert',
            'async_hooks',
            'base',
            'buffer',
            'child_process',
            'cluster',
            'console',
            'constants',
            'crypto',
            'dgram',
            'dns',
            'domain',
            'events',
            'fs',
            'globals',
            'http',
            'http2',
            'https',
            'index',
            'inspector',
            'module',
            'net',
            'os',
            'path',
            'perf_hooks',
            'process',
            'punycode',
            'querystring',
            'readline',
            'repl',
            'stream',
            'string_decoder',
            'timers',
            'tls',
            'trace_events',
            'tty',
            'url',
            'util',
            'v8',
            'vm',
            'worker_threads',
            'zlib',
        ];
        if (builtInNodeMods.includes(name)) {
            return 'node';
        }
        return name;
    };
    //** A really dumb version of path.resolve */
    const mapRelativePath = (moduleDeclaration, currentPath) => {
        // https://stackoverflow.com/questions/14780350/convert-relative-path-to-absolute-using-javascript
        function absolute(base, relative) {
            if (!base)
                return relative;
            const stack = base.split('/');
            const parts = relative.split('/');
            stack.pop(); // remove current file name (or empty string)
            for (var i = 0; i < parts.length; i++) {
                if (parts[i] == '.')
                    continue;
                if (parts[i] == '..')
                    stack.pop();
                else
                    stack.push(parts[i]);
            }
            return stack.join('/');
        }
        return absolute(currentPath, moduleDeclaration);
    };
    const convertToModuleReferenceID = (outerModule, moduleDeclaration, currentPath) => {
        const modIsScopedPackageOnly = moduleDeclaration.indexOf('@') === 0 && moduleDeclaration.split('/').length === 2;
        const modIsPackageOnly = moduleDeclaration.indexOf('@') === -1 && moduleDeclaration.split('/').length === 1;
        const isPackageRootImport = modIsPackageOnly || modIsScopedPackageOnly;
        if (isPackageRootImport) {
            return moduleDeclaration;
        }
        else {
            return `${outerModule}-${mapRelativePath(moduleDeclaration, currentPath)}`;
        }
    };
    /**
     * Takes an initial module and the path for the root of the typings and grab it and start grabbing its
     * dependencies then add those the to runtime.
     */
    const addModuleToRuntime = (mod, path, config) => __awaiter(void 0, void 0, void 0, function* () {
        const isDeno = path && path.indexOf('https://') === 0;
        const dtsFileURL = isDeno ? path : unpkgURL(mod, path);
        const content = yield getCachedDTSString(config, dtsFileURL);
        if (!content) {
            return errorMsg(`Could not get root d.ts file for the module '${mod}' at ${path}`, {}, config);
        }
        // Now look and grab dependent modules where you need the
        yield getDependenciesForModule(content, mod, path, config);
        if (isDeno) {
            const wrapped = `declare module "${path}" { ${content} }`;
            config.addLibraryToRuntime(wrapped, path);
        }
        else {
            const typelessModule = mod.split('@types/').slice(-1);
            const wrapped = `declare module "${typelessModule}" { ${content} }`;
            config.addLibraryToRuntime(wrapped, `node_modules/${mod}/${path}`);
        }
    });
    /**
     * Takes a module import, then uses both the algolia API and the the package.json to derive
     * the root type def path.
     *
     * @param {string} packageName
     * @returns {Promise<{ mod: string, path: string, packageJSON: any }>}
     */
    const getModuleAndRootDefTypePath = (packageName, config) => __awaiter(void 0, void 0, void 0, function* () {
        const url = moduleJSONURL(packageName);
        const response = yield config.fetcher(url);
        if (!response.ok) {
            return errorMsg(`Could not get Algolia JSON for the module '${packageName}'`, response, config);
        }
        const responseJSON = yield response.json();
        if (!responseJSON) {
            return errorMsg(`Could the Algolia JSON was un-parsable for the module '${packageName}'`, response, config);
        }
        if (!responseJSON.types) {
            return config.logger.log(`There were no types for '${packageName}' - will not try again in this session`);
        }
        if (!responseJSON.types.ts) {
            return config.logger.log(`There were no types for '${packageName}' - will not try again in this session`);
        }
        exports.acquiredTypeDefs[packageName] = responseJSON;
        if (responseJSON.types.ts === 'included') {
            const modPackageURL = packageJSONURL(packageName);
            const response = yield config.fetcher(modPackageURL);
            if (!response.ok) {
                return errorMsg(`Could not get Package JSON for the module '${packageName}'`, response, config);
            }
            const responseJSON = yield response.json();
            if (!responseJSON) {
                return errorMsg(`Could not get Package JSON for the module '${packageName}'`, response, config);
            }
            config.addLibraryToRuntime(JSON.stringify(responseJSON, null, '  '), `node_modules/${packageName}/package.json`);
            // Get the path of the root d.ts file
            // non-inferred route
            let rootTypePath = responseJSON.typing || responseJSON.typings || responseJSON.types;
            // package main is custom
            if (!rootTypePath && typeof responseJSON.main === 'string' && responseJSON.main.indexOf('.js') > 0) {
                rootTypePath = responseJSON.main.replace(/js$/, 'd.ts');
            }
            // Final fallback, to have got here it must have passed in algolia
            if (!rootTypePath) {
                rootTypePath = 'index.d.ts';
            }
            return { mod: packageName, path: rootTypePath, packageJSON: responseJSON };
        }
        else if (responseJSON.types.ts === 'definitely-typed') {
            return { mod: responseJSON.types.definitelyTyped, path: 'index.d.ts', packageJSON: responseJSON };
        }
        else {
            throw "This shouldn't happen";
        }
    });
    const getCachedDTSString = (config, url) => __awaiter(void 0, void 0, void 0, function* () {
        const cached = localStorage.getItem(url);
        if (cached) {
            const [dateString, text] = cached.split('-=-^-=-');
            const cachedDate = new Date(dateString);
            const now = new Date();
            const cacheTimeout = 604800000; // 1 week
            // const cacheTimeout = 60000 // 1 min
            if (now.getTime() - cachedDate.getTime() < cacheTimeout) {
                return lzstring_min_1.default.decompressFromUTF16(text);
            }
            else {
                config.logger.log('Skipping cache for ', url);
            }
        }
        const response = yield config.fetcher(url);
        if (!response.ok) {
            return errorMsg(`Could not get DTS response for the module at ${url}`, response, config);
        }
        // TODO: handle checking for a resolve to index.d.ts whens someone imports the folder
        let content = yield response.text();
        if (!content) {
            return errorMsg(`Could not get text for DTS response at ${url}`, response, config);
        }
        const now = new Date();
        const cacheContent = `${now.toISOString()}-=-^-=-${lzstring_min_1.default.compressToUTF16(content)}`;
        localStorage.setItem(url, cacheContent);
        return content;
    });
    const getReferenceDependencies = (sourceCode, mod, path, config) => __awaiter(void 0, void 0, void 0, function* () {
        var match;
        if (sourceCode.indexOf('reference path') > 0) {
            // https://regex101.com/r/DaOegw/1
            const referencePathExtractionPattern = /<reference path="(.*)" \/>/gm;
            while ((match = referencePathExtractionPattern.exec(sourceCode)) !== null) {
                const relativePath = match[1];
                if (relativePath) {
                    let newPath = mapRelativePath(relativePath, path);
                    if (newPath) {
                        const dtsRefURL = unpkgURL(mod, newPath);
                        const dtsReferenceResponseText = yield getCachedDTSString(config, dtsRefURL);
                        if (!dtsReferenceResponseText) {
                            return errorMsg(`Could not get root d.ts file for the module '${mod}' at ${path}`, {}, config);
                        }
                        yield getDependenciesForModule(dtsReferenceResponseText, mod, newPath, config);
                        const representationalPath = `node_modules/${mod}/${newPath}`;
                        config.addLibraryToRuntime(dtsReferenceResponseText, representationalPath);
                    }
                }
            }
        }
    });
    /**
     * Pseudo in-browser type acquisition tool, uses a
     */
    exports.detectNewImportsToAcquireTypeFor = (sourceCode, userAddLibraryToRuntime, fetcher = fetch, playgroundConfig) => __awaiter(void 0, void 0, void 0, function* () {
        // Wrap the runtime func with our own side-effect for visibility
        const addLibraryToRuntime = (code, path) => {
            globalishObj.typeDefinitions[path] = code;
            userAddLibraryToRuntime(code, path);
        };
        // Basically start the recursion with an undefined module
        const config = { sourceCode, addLibraryToRuntime, fetcher, logger: playgroundConfig.logger };
        const results = getDependenciesForModule(sourceCode, undefined, 'playground.ts', config);
        return results;
    });
    /**
     * Looks at a JS/DTS file and recurses through all the dependencies.
     * It avoids
     */
    const getDependenciesForModule = (sourceCode, moduleName, path, config) => {
        // Get all the import/requires for the file
        const filteredModulesToLookAt = parseFileForModuleReferences(sourceCode);
        filteredModulesToLookAt.forEach((name) => __awaiter(void 0, void 0, void 0, function* () {
            // Support grabbing the hard-coded node modules if needed
            const moduleToDownload = mapModuleNameToModule(name);
            if (!moduleName && moduleToDownload.startsWith('.')) {
                return config.logger.log("[ATA] Can't resolve relative dependencies from the playground root");
            }
            const moduleID = convertToModuleReferenceID(moduleName, moduleToDownload, moduleName);
            if (exports.acquiredTypeDefs[moduleID] || exports.acquiredTypeDefs[moduleID] === null) {
                return;
            }
            config.logger.log(`[ATA] Looking at ${moduleToDownload}`);
            const modIsScopedPackageOnly = moduleToDownload.indexOf('@') === 0 && moduleToDownload.split('/').length === 2;
            const modIsPackageOnly = moduleToDownload.indexOf('@') === -1 && moduleToDownload.split('/').length === 1;
            const isPackageRootImport = modIsPackageOnly || modIsScopedPackageOnly;
            const isDenoModule = moduleToDownload.indexOf('https://') === 0;
            if (isPackageRootImport) {
                // So it doesn't run twice for a package
                exports.acquiredTypeDefs[moduleID] = null;
                // E.g. import danger from "danger"
                const packageDef = yield getModuleAndRootDefTypePath(moduleToDownload, config);
                if (packageDef) {
                    exports.acquiredTypeDefs[moduleID] = packageDef.packageJSON;
                    yield addModuleToRuntime(packageDef.mod, packageDef.path, config);
                }
            }
            else if (isDenoModule) {
                // E.g. import { serve } from "https://deno.land/std@v0.12/http/server.ts";
                yield addModuleToRuntime(moduleToDownload, moduleToDownload, config);
            }
            else {
                // E.g. import {Component} from "./MyThing"
                if (!moduleToDownload || !path)
                    throw `No outer module or path for a relative import: ${moduleToDownload}`;
                const absolutePathForModule = mapRelativePath(moduleToDownload, path);
                // So it doesn't run twice for a package
                exports.acquiredTypeDefs[moduleID] = null;
                const resolvedFilepath = absolutePathForModule.endsWith('.ts')
                    ? absolutePathForModule
                    : absolutePathForModule + '.d.ts';
                yield addModuleToRuntime(moduleName, resolvedFilepath, config);
            }
        }));
        // Also support the
        getReferenceDependencies(sourceCode, moduleName, path, config);
    };
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZUFjcXVpc2l0aW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc2FuZGJveC9zcmMvdHlwZUFjcXVpc2l0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7SUFHQSxNQUFNLFlBQVksR0FBUSxPQUFPLFVBQVUsS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQTtJQUN2RixZQUFZLENBQUMsZUFBZSxHQUFHLEVBQUUsQ0FBQTtJQUVqQzs7O09BR0c7SUFDVSxRQUFBLGdCQUFnQixHQUFzQyxZQUFZLENBQUMsZUFBZSxDQUFBO0lBSS9GLE1BQU0sYUFBYSxHQUFHLENBQUMsSUFBWSxFQUFFLEVBQUU7SUFDckMsa0JBQWtCO0lBQ2xCLDJEQUEyRCxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsaUxBQWlMLENBQUE7SUFFdFEsTUFBTSxRQUFRLEdBQUcsQ0FBQyxJQUFZLEVBQUUsSUFBWSxFQUFFLEVBQUUsQ0FDOUMseUJBQXlCLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUE7SUFFakYsTUFBTSxjQUFjLEdBQUcsQ0FBQyxJQUFZLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUE7SUFFdkUsTUFBTSxRQUFRLEdBQUcsQ0FBQyxHQUFXLEVBQUUsUUFBYSxFQUFFLE1BQWlCLEVBQUUsRUFBRTtRQUNqRSxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxHQUFHLEdBQUcsdUNBQXVDLEVBQUUsUUFBUSxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsVUFBVSxFQUFFLFFBQVEsQ0FBQyxDQUFBO1FBQ2xILFFBQVEsQ0FBQTtJQUNWLENBQUMsQ0FBQTtJQUVEOzs7T0FHRztJQUNILE1BQU0sNEJBQTRCLEdBQUcsQ0FBQyxVQUFrQixFQUFF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cG9ydCB7IFBsYXlncm91bmRDb25maWcgfSBmcm9tICcuLydcbmltcG9ydCBsenN0cmluZyBmcm9tICcuL3ZlbmRvci9senN0cmluZy5taW4nXG5cbmNvbnN0IGdsb2JhbGlzaE9iajogYW55ID0gdHlwZW9mIGdsb2JhbFRoaXMgIT09ICd1bmRlZmluZWQnID8gZ2xvYmFsVGhpcyA6IHdpbmRvdyB8fCB7fVxuZ2xvYmFsaXNoT2JqLnR5cGVEZWZpbml0aW9ucyA9IHt9XG5cbi8qKlxuICogVHlwZSBEZWZzIHdlJ3ZlIGFscmVhZHkgZ290LCBhbmQgbnVsbHMgd2hlbiBzb21ldGhpbmcgaGFzIGZhaWxlZC5cbiAqIFRoaXMgaXMgdG8gbWFrZSBzdXJlIHRoYXQgaXQgZG9lc24ndCBpbmZpbml0ZSBsb29wLlxuICovXG5leHBvcnQgY29uc3QgYWNxdWlyZWRUeXBlRGVmczogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIHwgbnVsbCB9ID0gZ2xvYmFsaXNoT2JqLnR5cGVEZWZpbml0aW9uc1xuXG5leHBvcnQgdHlwZSBBZGRMaWJUb1J1bnRpbWVGdW5jID0gKGNvZGU6IHN0cmluZywgcGF0aDogc3RyaW5nKSA9PiB2b2lkXG5cbmNvbnN0IG1vZHVsZUpTT05VUkwgPSAobmFtZTogc3RyaW5nKSA9PlxuICAvLyBwcmV0dGllci1pZ25vcmVcbiAgYGh0dHBzOi8vb2ZjbmNvZzJjdS1kc24uYWxnb2xpYS5uZXQvMS9pbmRleGVzL25wbS1zZWFyY2gvJHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9P2F0dHJpYnV0ZXM9dHlwZXMmeC1hbGdvbGlhLWFnZW50PUFsZ29saWElMjBmb3IlMjB2YW5pbGxhJTIwSmF2YVNjcmlwdCUyMChsaXRlKSUyMDMuMjcuMSZ4LWFsZ29saWEtYXBwbGljYXRpb24taWQ9T0ZDTkNPRzJDVSZ4LWFsZ29saWEtYXBpLWtleT1mNTRlMjFmYTNhMmEwMTYwNTk1YmIwNTgxNzliZmIxZWBcblxuY29uc3QgdW5wa2dVUkwgPSAobmFtZTogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+XG4gIGBodHRwczovL3d3dy51bnBrZy5jb20vJHtlbmNvZGVVUklDb21wb25lbnQobmFtZSl9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHBhdGgpfWBcblxuY29uc3QgcGFja2FnZUpTT05VUkwgPSAobmFtZTogc3RyaW5nKSA9PiB1bnBrZ1VSTChuYW1lLCAncGFja2FnZS5qc29uJylcblxuY29uc3QgZXJyb3JNc2cgPSAobXNnOiBzdHJpbmcsIHJlc3BvbnNlOiBhbnksIGNvbmZpZzogQVRBQ29uZmlnKSA9PiB7XG4gIGNvbmZpZy5sb2dnZXIuZXJyb3IoYCR7bXNnfSAtIHdpbGwgbm90IHRyeSBhZ2FpbiBpbiB0aGlzIHNlc3Npb25gLCByZXNwb25zZS5zdGF0dXMsIHJlc3BvbnNlLnN0YXR1c1RleHQsIHJlc3BvbnNlKVxuICBkZWJ1Z2dlclxufVxuXG4vKipcbiAqIEdyYWIgYW55IGltcG9ydC9yZXF1aXJlcyBmcm9tIGluc2lkZSB0aGUgY29kZSBhbmQgbWFrZSBhIGxpc3Qgb2ZcbiAqIGl0cyBkZXBlbmRlbmNpZXNcbiAqL1xuY29uc3QgcGFyc2VGaWxlRm9yTW9kdWxlUmVmZXJlbmNlcyA9IChzb3VyY2VDb2RlOiBzdHJpbmcpID0+IHtcbiAgLy8gaHR0cHM6Ly9yZWdleDEwMS5jb20vci9KeGEzS1gvNFxuICBjb25zdCByZXF1aXJlUGF0dGVybiA9IC8oY29uc3R8bGV0fHZhcikoLnxcXG4pKj8gcmVxdWlyZVxcKCgnfFwiKSguKikoJ3xcIilcXCk7PyQvXG4gIC8vIHRoaXMgaGFuZGxlIHRocyAnZnJvbScgaW1wb3J0cyAgaHR0cHM6Ly9yZWdleDEwMS5jb20vci9oZEVwek8vNFxuICBjb25zdCBlczZQYXR0ZXJuID0gLyhpbXBvcnR8ZXhwb3J0KSgoPyFmcm9tKSg/IXJlcXVpcmUpKC58XFxuKSkqPyhmcm9tfHJlcXVpcmVcXCgpXFxzPygnfFwiKSguKikoJ3xcIilcXCk/Oz8kL2dtXG4gIC8vIGh0dHBzOi8vcmVnZXgxMDEuY29tL3IvaGRFcHpPLzZcbiAgY29uc3QgZXM2SW1wb3J0T25seSA9IC9pbXBvcnRcXHM/KCd8XCIpKC4qKSgnfFwiKVxcKT87Py9nbVxuXG4gIGNvbnN0IGZvdW5kTW9kdWxlcyA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIHZhciBtYXRjaFxuXG4gIHdoaWxlICgobWF0Y2ggPSBlczZQYXR0ZXJuLmV4ZWMoc291cmNlQ29kZSkpICE9PSBudWxsKSB7XG4gICAgaWYgKG1hdGNoWzZdKSBmb3VuZE1vZHVsZXMuYWRkKG1hdGNoWzZdKVxuICB9XG5cbiAgd2hpbGUgKChtYXRjaCA9IHJlcXVpcmVQYXR0ZXJuLmV4ZWMoc291cmNlQ29kZSkpICE9PSBudWxsKSB7XG4gICAgaWYgKG1hdGNoWzVdKSBmb3VuZE1vZHVsZXMuYWRkKG1hdGNoWzVdKVxuICB9XG5cbiAgd2hpbGUgKChtYXRjaCA9IGVzNkltcG9ydE9ubHkuZXhlYyhzb3VyY2VDb2RlKSkgIT09IG51bGwpIHtcbiAgICBpZiAobWF0Y2hbMl0pIGZvdW5kTW9kdWxlcy5hZGQobWF0Y2hbMl0pXG4gIH1cblxuICByZXR1cm4gQXJyYXkuZnJvbShmb3VuZE1vZHVsZXMpXG59XG5cbi8qKiBDb252ZXJ0cyBzb21lIG9mIHRoZSBrbm93biBnbG9iYWwgaW1wb3J0cyB0byBub2RlIHNvIHRoYXQgd2UgZ3JhYiB0aGUgcmlnaHQgaW5mbyAqL1xuY29uc3QgbWFwTW9kdWxlTmFtZVRvTW9kdWxlID0gKG5hbWU6IHN0cmluZykgPT4ge1xuICAvLyBpbiBub2RlIHJlcGw6XG4gIC8vID4gcmVxdWlyZShcIm1vZHVsZVwiKS5idWlsdGluTW9kdWxlc1xuICBjb25zdCBidWlsdEluTm9kZU1vZHMgPSBbXG4gICAgJ2Fzc2VydCcsXG4gICAgJ2FzeW5jX2hvb2tzJyxcbiAgICAnYmFzZScsXG4gICAgJ2J1ZmZlcicsXG4gICAgJ2NoaWxkX3Byb2Nlc3MnLFxuICAgICdjbHVzdGVyJyxcbiAgICAnY29uc29sZScsXG4gICAgJ2NvbnN0YW50cycsXG4gICAgJ2NyeXB0bycsXG4gICAgJ2RncmFtJyxcbiAgICAnZG5zJyxcbiAgICAnZG9tYWluJyxcbiAgICAnZXZlbnRzJyxcbiAgICAnZnMnLFxuICAgICdnbG9iYWxzJyxcbiAgICAnaHR0cCcsXG4gICAgJ2h0dHAyJyxcbiAgICAnaHR0cHMnLFxuICAgICdpbmRleCcsXG4gICAgJ2luc3BlY3RvcicsXG4gICAgJ21vZHVsZScsXG4gICAgJ25ldCcsXG4gICAgJ29zJyxcbiAgICAncGF0aCcsXG4gICAgJ3BlcmZfaG9va3MnLFxuICAgICdwcm9jZXNzJyxcbiAgICAncHVueWNvZGUnLFxuICAgICdxdWVyeXN0cmluZycsXG4gICAgJ3JlYWRsaW5lJyxcbiAgICAncmVwbCcsXG4gICAgJ3N0cmVhbScsXG4gICAgJ3N0cmluZ19kZWNvZGVyJyxcbiAgICAndGltZXJzJyxcbiAgICAndGxzJyxcbiAgICAndHJhY2VfZXZlbnRzJyxcbiAgICAndHR5JyxcbiAgICAndXJsJyxcbiAgICAndXRpbCcsXG4gICAgJ3Y4JyxcbiAgICAndm0nLFxuICAgICd3b3JrZXJfdGhyZWFkcycsXG4gICAgJ3psaWInLFxuICBdXG5cbiAgaWYgKGJ1aWx0SW5Ob2RlTW9kcy5pbmNsdWRlcyhuYW1lKSkge1xuICAgIHJldHVybiAnbm9kZSdcbiAgfVxuICByZXR1cm4gbmFtZVxufVxuXG4vLyoqIEEgcmVhbGx5IGR1bWIgdmVyc2lvbiBvZiBwYXRoLnJlc29sdmUgKi9cbmNvbnN0IG1hcFJlbGF0aXZlUGF0aCA9IChtb2R1bGVEZWNsYXJhdGlvbjogc3RyaW5nLCBjdXJyZW50UGF0aDogc3RyaW5nKSA9PiB7XG4gIC8vIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzE0NzgwMzUwL2NvbnZlcnQtcmVsYXRpdmUtcGF0aC10by1hYnNvbHV0ZS11c2luZy1qYXZhc2NyaXB0XG4gIGZ1bmN0aW9uIGFic29sdXRlKGJhc2U6IHN0cmluZywgcmVsYXRpdmU6IHN0cmluZykge1xuICAgIGlmICghYmFzZSkgcmV0dXJuIHJlbGF0aXZlXG5cbiAgICBjb25zdCBzdGFjayA9IGJhc2Uuc3BsaXQoJy8nKVxuICAgIGNvbnN0IHBhcnRzID0gcmVsYXRpdmUuc3BsaXQoJy8nKVxuICAgIHN0YWNrLnBvcCgpIC8vIHJlbW92ZSBjdXJyZW50IGZpbGUgbmFtZSAob3IgZW1wdHkgc3RyaW5nKVxuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHBhcnRzW2ldID09ICcuJykgY29udGludWVcbiAgICAgIGlmIChwYXJ0c1tpXSA9PSAnLi4nKSBzdGFjay5wb3AoKVxuICAgICAgZWxzZSBzdGFjay5wdXNoKHBhcnRzW2ldKVxuICAgIH1cbiAgICByZXR1cm4gc3RhY2suam9pbignLycpXG4gIH1cblxuICByZXR1cm4gYWJzb2x1dGUoY3VycmVudFBhdGgsIG1vZHVsZURlY2xhcmF0aW9uKVxufVxuXG5jb25zdCBjb252ZXJ0VG9Nb2R1bGVSZWZlcmVuY2VJRCA9IChvdXRlck1vZHVsZTogc3RyaW5nLCBtb2R1bGVEZWNsYXJhdGlvbjogc3RyaW5nLCBjdXJyZW50UGF0aDogc3RyaW5nKSA9PiB7XG4gIGNvbnN0IG1vZElzU2NvcGVkUGFja2FnZU9ubHkgPSBtb2R1bGVEZWNsYXJhdGlvbi5pbmRleE9mKCdAJykgPT09IDAgJiYgbW9kdWxlRGVjbGFyYXRpb24uc3BsaXQoJy8nKS5sZW5ndGggPT09IDJcbiAgY29uc3QgbW9kSXNQYWNrYWdlT25seSA9IG1vZHVsZURlY2xhcmF0aW9uLmluZGV4T2YoJ0AnKSA9PT0gLTEgJiYgbW9kdWxlRGVjbGFyYXRpb24uc3BsaXQoJy8nKS5sZW5ndGggPT09IDFcbiAgY29uc3QgaXNQYWNrYWdlUm9vdEltcG9ydCA9IG1vZElzUGFja2FnZU9ubHkgfHwgbW9kSXNTY29wZWRQYWNrYWdlT25seVxuXG4gIGlmIChpc1BhY2thZ2VSb290SW1wb3J0KSB7XG4gICAgcmV0dXJuIG1vZHVsZURlY2xhcmF0aW9uXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGAke291dGVyTW9kdWxlfS0ke21hcFJlbGF0aXZlUGF0aChtb2R1bGVEZWNsYXJhdGlvbiwgY3VycmVudFBhdGgpfWBcbiAgfVxufVxuXG4vKipcbiAqIFRha2VzIGFuIGluaXRpYWwgbW9kdWxlIGFuZCB0aGUgcGF0aCBmb3IgdGhlIHJvb3Qgb2YgdGhlIHR5cGluZ3MgYW5kIGdyYWIgaXQgYW5kIHN0YXJ0IGdyYWJiaW5nIGl0c1xuICogZGVwZW5kZW5jaWVzIHRoZW4gYWRkIHRob3NlIHRoZSB0byBydW50aW1lLlxuICovXG5jb25zdCBhZGRNb2R1bGVUb1J1bnRpbWUgPSBhc3luYyAobW9kOiBzdHJpbmcsIHBhdGg6IHN0cmluZywgY29uZmlnOiBBVEFDb25maWcpID0+IHtcbiAgY29uc3QgaXNEZW5vID0gcGF0aCAmJiBwYXRoLmluZGV4T2YoJ2h0dHBzOi8vJykgPT09IDBcblxuICBjb25zdCBkdHNGaWxlVVJMID0gaXNEZW5vID8gcGF0aCA6IHVucGtnVVJMKG1vZCwgcGF0aClcblxuICBjb25zdCBjb250ZW50ID0gYXdhaXQgZ2V0Q2FjaGVkRFRTU3RyaW5nKGNvbmZpZywgZHRzRmlsZVVSTClcbiAgaWYgKCFjb250ZW50KSB7XG4gICAgcmV0dXJuIGVycm9yTXNnKGBDb3VsZCBub3QgZ2V0IHJvb3QgZC50cyBmaWxlIGZvciB0aGUgbW9kdWxlICcke21vZH0nIGF0ICR7cGF0aH1gLCB7fSwgY29uZmlnKVxuICB9XG5cbiAgLy8gTm93IGxvb2sgYW5kIGdyYWIgZGVwZW5kZW50IG1vZHVsZXMgd2hlcmUgeW91IG5lZWQgdGhlXG4gIGF3YWl0IGdldERlcGVuZGVuY2llc0Zvck1vZHVsZShjb250ZW50LCBtb2QsIHBhdGgsIGNvbmZpZylcblxuICBpZiAoaXNEZW5vKSB7XG4gICAgY29uc3Qgd3JhcHBlZCA9IGBkZWNsYXJlIG1vZHVsZSBcIiR7cGF0aH1cIiB7ICR7Y29udGVudH0gfWBcbiAgICBjb25maWcuYWRkTGlicmFyeVRvUnVudGltZSh3cmFwcGVkLCBwYXRoKVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IHR5cGVsZXNzTW9kdWxlID0gbW9kLnNwbGl0KCdAdHlwZXMvJykuc2xpY2UoLTEpXG4gICAgY29uc3Qgd3JhcHBlZCA9IGBkZWNsYXJlIG1vZHVsZSBcIiR7dHlwZWxlc3NNb2R1bGV9XCIgeyAke2NvbnRlbnR9IH1gXG4gICAgY29uZmlnLmFkZExpYnJhcnlUb1J1bnRpbWUod3JhcHBlZCwgYG5vZGVfbW9kdWxlcy8ke21vZH0vJHtwYXRofWApXG4gIH1cbn1cblxuLyoqXG4gKiBUYWtlcyBhIG1vZHVsZSBpbXBvcnQsIHRoZW4gdXNlcyBib3RoIHRoZSBhbGdvbGlhIEFQSSBhbmQgdGhlIHRoZSBwYWNrYWdlLmpzb24gdG8gZGVyaXZlXG4gKiB0aGUgcm9vdCB0eXBlIGRlZiBwYXRoLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYWNrYWdlTmFtZVxuICogQHJldHVybnMge1Byb21pc2U8eyBtb2Q6IHN0cmluZywgcGF0aDogc3RyaW5nLCBwYWNrYWdlSlNPTjogYW55IH0+fVxuICovXG5jb25zdCBnZXRNb2R1bGVBbmRSb290RGVmVHlwZVBhdGggPSBhc3luYyAocGFja2FnZU5hbWU6IHN0cmluZywgY29uZmlnOiBBVEFDb25maWcpID0+IHtcbiAgY29uc3QgdXJsID0gbW9kdWxlSlNPTlVSTChwYWNrYWdlTmFtZSlcblxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNvbmZpZy5mZXRjaGVyKHVybClcbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHJldHVybiBlcnJvck1zZyhgQ291bGQgbm90IGdldCBBbGdvbGlhIEpTT04gZm9yIHRoZSBtb2R1bGUgJyR7cGFja2FnZU5hbWV9J2AsIHJlc3BvbnNlLCBjb25maWcpXG4gIH1cblxuICBjb25zdCByZXNwb25zZUpTT04gPSBhd2FpdCByZXNwb25zZS5qc29uKClcbiAgaWYgKCFyZXNwb25zZUpTT04pIHtcbiAgICByZXR1cm4gZXJyb3JNc2coYENvdWxkIHRoZSBBbGdvbGlhIEpTT04gd2FzIHVuLXBhcnNhYmxlIGZvciB0aGUgbW9kdWxlICcke3BhY2thZ2VOYW1lfSdgLCByZXNwb25zZSwgY29uZmlnKVxuICB9XG5cbiAgaWYgKCFyZXNwb25zZUpTT04udHlwZXMpIHtcbiAgICByZXR1cm4gY29uZmlnLmxvZ2dlci5sb2coYFRoZXJlIHdlcmUgbm8gdHlwZXMgZm9yICcke3BhY2thZ2VOYW1lfScgLSB3aWxsIG5vdCB0cnkgYWdhaW4gaW4gdGhpcyBzZXNzaW9uYClcbiAgfVxuICBpZiAoIXJlc3BvbnNlSlNPTi50eXBlcy50cykge1xuICAgIHJldHVybiBjb25maWcubG9nZ2VyLmxvZyhgVGhlcmUgd2VyZSBubyB0eXBlcyBmb3IgJyR7cGFja2FnZU5hbWV9JyAtIHdpbGwgbm90IHRyeSBhZ2FpbiBpbiB0aGlzIHNlc3Npb25gKVxuICB9XG5cbiAgYWNxdWlyZWRUeXBlRGVmc1twYWNrYWdlTmFtZV0gPSByZXNwb25zZUpTT05cblxuICBpZiAocmVzcG9uc2VKU09OLnR5cGVzLnRzID09PSAnaW5jbHVkZWQnKSB7XG4gICAgY29uc3QgbW9kUGFja2FnZVVSTCA9IHBhY2thZ2VKU09OVVJMKHBhY2thZ2VOYW1lKVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjb25maWcuZmV0Y2hlcihtb2RQYWNrYWdlVVJMKVxuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIHJldHVybiBlcnJvck1zZyhgQ291bGQgbm90IGdldCBQYWNrYWdlIEpTT04gZm9yIHRoZSBtb2R1bGUgJyR7cGFja2FnZU5hbWV9J2AsIHJlc3BvbnNlLCBjb25maWcpXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2VKU09OID0gYXdhaXQgcmVzcG9uc2UuanNvbigpXG4gICAgaWYgKCFyZXNwb25zZUpTT04pIHtcbiAgICAgIHJldHVybiBlcnJvck1zZyhgQ291bGQgbm90IGdldCBQYWNrYWdlIEpTT04gZm9yIHRoZSBtb2R1bGUgJyR7cGFja2FnZU5hbWV9J2AsIHJlc3BvbnNlLCBjb25maWcpXG4gICAgfVxuXG4gICAgY29uZmlnLmFkZExpYnJhcnlUb1J1bnRpbWUoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2VKU09OLCBudWxsLCAnICAnKSwgYG5vZGVfbW9kdWxlcy8ke3BhY2thZ2VOYW1lfS9wYWNrYWdlLmpzb25gKVxuXG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSByb290IGQudHMgZmlsZVxuXG4gICAgLy8gbm9uLWluZmVycmVkIHJvdXRlXG4gICAgbGV0IHJvb3RUeXBlUGF0aCA9IHJlc3BvbnNlSlNPTi50eXBpbmcgfHwgcmVzcG9uc2VKU09OLnR5cGluZ3MgfHwgcmVzcG9uc2VKU09OLnR5cGVzXG5cbiAgICAvLyBwYWNrYWdlIG1haW4gaXMgY3VzdG9tXG4gICAgaWYgKCFyb290VHlwZVBhdGggJiYgdHlwZW9mIHJlc3BvbnNlSlNPTi5tYWluID09PSAnc3RyaW5nJyAmJiByZXNwb25zZUpTT04ubWFpbi5pbmRleE9mKCcuanMnKSA+IDApIHtcbiAgICAgIHJvb3RUeXBlUGF0aCA9IHJlc3BvbnNlSlNPTi5tYWluLnJlcGxhY2UoL2pzJC8sICdkLnRzJylcbiAgICB9XG5cbiAgICAvLyBGaW5hbCBmYWxsYmFjaywgdG8gaGF2ZSBnb3QgaGVyZSBpdCBtdXN0IGhhdmUgcGFzc2VkIGluIGFsZ29saWFcbiAgICBpZiAoIXJvb3RUeXBlUGF0aCkge1xuICAgICAgcm9vdFR5cGVQYXRoID0gJ2luZGV4LmQudHMnXG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbW9kOiBwYWNrYWdlTmFtZSwgcGF0aDogcm9vdFR5cGVQYXRoLCBwYWNrYWdlSlNPTjogcmVzcG9uc2VKU09OIH1cbiAgfSBlbHNlIGlmIChyZXNwb25zZUpTT04udHlwZXMudHMgPT09ICdkZWZpbml0ZWx5LXR5cGVkJykge1xuICAgIHJldHVybiB7IG1vZDogcmVzcG9uc2VKU09OLnR5cGVzLmRlZmluaXRlbHlUeXBlZCwgcGF0aDogJ2luZGV4LmQudHMnLCBwYWNrYWdlSlNPTjogcmVzcG9uc2VKU09OIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBcIlRoaXMgc2hvdWxkbid0IGhhcHBlblwiXG4gIH1cbn1cblxuY29uc3QgZ2V0Q2FjaGVkRFRTU3RyaW5nID0gYXN5bmMgKGNvbmZpZzogQVRBQ29uZmlnLCB1cmw6IHN0cmluZykgPT4ge1xuICBjb25zdCBjYWNoZWQgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSh1cmwpXG4gIGlmIChjYWNoZWQpIHtcbiAgICBjb25zdCBbZGF0ZVN0cmluZywgdGV4dF0gPSBjYWNoZWQuc3BsaXQoJy09LV4tPS0nKVxuICAgIGNvbnN0IGNhY2hlZERhdGUgPSBuZXcgRGF0ZShkYXRlU3RyaW5nKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcblxuICAgIGNvbnN0IGNhY2hlVGltZW91dCA9IDYwNDgwMDAwMCAvLyAxIHdlZWtcbiAgICAvLyBjb25zdCBjYWNoZVRpbWVvdXQgPSA2MDAwMCAvLyAxIG1pblxuXG4gICAgaWYgKG5vdy5nZXRUaW1lKCkgLSBjYWNoZWREYXRlLmdldFRpbWUoKSA8IGNhY2hlVGltZW91dCkge1xuICAgICAgcmV0dXJuIGx6c3RyaW5nLmRlY29tcHJlc3NGcm9tVVRGMTYodGV4dClcbiAgICB9IGVsc2Uge1xuICAgICAgY29uZmlnLmxvZ2dlci5sb2coJ1NraXBwaW5nIGNhY2hlIGZvciAnLCB1cmwpXG4gICAgfVxuICB9XG5cbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjb25maWcuZmV0Y2hlcih1cmwpXG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICByZXR1cm4gZXJyb3JNc2coYENvdWxkIG5vdCBnZXQgRFRTIHJlc3BvbnNlIGZvciB0aGUgbW9kdWxlIGF0ICR7dXJsfWAsIHJlc3BvbnNlLCBjb25maWcpXG4gIH1cblxuICAvLyBUT0RPOiBoYW5kbGUgY2hlY2tpbmcgZm9yIGEgcmVzb2x2ZSB0byBpbmRleC5kLnRzIHdoZW5zIHNvbWVvbmUgaW1wb3J0cyB0aGUgZm9sZGVyXG4gIGxldCBjb250ZW50ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpXG4gIGlmICghY29udGVudCkge1xuICAgIHJldHVybiBlcnJvck1zZyhgQ291bGQgbm90IGdldCB0ZXh0IGZvciBEVFMgcmVzcG9uc2UgYXQgJHt1cmx9YCwgcmVzcG9uc2UsIGNvbmZpZylcbiAgfVxuXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgY29uc3QgY2FjaGVDb250ZW50ID0gYCR7bm93LnRvSVNPU3RyaW5nKCl9LT0tXi09LSR7bHpzdHJpbmcuY29tcHJlc3NUb1VURjE2KGNvbnRlbnQpfWBcbiAgbG9jYWxTdG9yYWdlLnNldEl0ZW0odXJsLCBjYWNoZUNvbnRlbnQpXG4gIHJldHVybiBjb250ZW50XG59XG5cbmNvbnN0IGdldFJlZmVyZW5jZURlcGVuZGVuY2llcyA9IGFzeW5jIChzb3VyY2VDb2RlOiBzdHJpbmcsIG1vZDogc3RyaW5nLCBwYXRoOiBzdHJpbmcsIGNvbmZpZzogQVRBQ29uZmlnKSA9PiB7XG4gIHZhciBtYXRjaFxuICBpZiAoc291cmNlQ29kZS5pbmRleE9mKCdyZWZlcmVuY2UgcGF0aCcpID4gMCkge1xuICAgIC8vIGh0dHBzOi8vcmVnZXgxMDEuY29tL3IvRGFPZWd3LzFcbiAgICBjb25zdCByZWZlcmVuY2VQYXRoRXh0cmFjdGlvblBhdHRlcm4gPSAvPHJlZmVyZW5jZSBwYXRoPVwiKC4qKVwiIFxcLz4vZ21cbiAgICB3aGlsZSAoKG1hdGNoID0gcmVmZXJlbmNlUGF0aEV4dHJhY3Rpb25QYXR0ZXJuLmV4ZWMoc291cmNlQ29kZSkpICE9PSBudWxsKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBtYXRjaFsxXVxuICAgICAgaWYgKHJlbGF0aXZlUGF0aCkge1xuICAgICAgICBsZXQgbmV3UGF0aCA9IG1hcFJlbGF0aXZlUGF0aChyZWxhdGl2ZVBhdGgsIHBhdGgpXG4gICAgICAgIGlmIChuZXdQYXRoKSB7XG4gICAgICAgICAgY29uc3QgZHRzUmVmVVJMID0gdW5wa2dVUkwobW9kLCBuZXdQYXRoKVxuXG4gICAgICAgICAgY29uc3QgZHRzUmVmZXJlbmNlUmVzcG9uc2VUZXh0ID0gYXdhaXQgZ2V0Q2FjaGVkRFRTU3RyaW5nKGNvbmZpZywgZHRzUmVmVVJMKVxuICAgICAgICAgIGlmICghZHRzUmVmZXJlbmNlUmVzcG9uc2VUZXh0KSB7XG4gICAgICAgICAgICByZXR1cm4gZXJyb3JNc2coYENvdWxkIG5vdCBnZXQgcm9vdCBkLnRzIGZpbGUgZm9yIHRoZSBtb2R1bGUgJyR7bW9kfScgYXQgJHtwYXRofWAsIHt9LCBjb25maWcpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgZ2V0RGVwZW5kZW5jaWVzRm9yTW9kdWxlKGR0c1JlZmVyZW5jZVJlc3BvbnNlVGV4dCwgbW9kLCBuZXdQYXRoLCBjb25maWcpXG4gICAgICAgICAgY29uc3QgcmVwcmVzZW50YXRpb25hbFBhdGggPSBgbm9kZV9tb2R1bGVzLyR7bW9kfS8ke25ld1BhdGh9YFxuICAgICAgICAgIGNvbmZpZy5hZGRMaWJyYXJ5VG9SdW50aW1lKGR0c1JlZmVyZW5jZVJlc3BvbnNlVGV4dCwgcmVwcmVzZW50YXRpb25hbFBhdGgpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuaW50ZXJmYWNlIEFUQUNvbmZpZyB7XG4gIHNvdXJjZUNvZGU6IHN0cmluZ1xuICBhZGRMaWJyYXJ5VG9SdW50aW1lOiBBZGRMaWJUb1J1bnRpbWVGdW5jXG4gIGZldGNoZXI6IHR5cGVvZiBmZXRjaFxuICBsb2dnZXI6IFBsYXlncm91bmRDb25maWdbJ2xvZ2dlciddXG59XG5cbi8qKlxuICogUHNldWRvIGluLWJyb3dzZXIgdHlwZSBhY3F1aXNpdGlvbiB0b29sLCB1c2VzIGFcbiAqL1xuZXhwb3J0IGNvbnN0IGRldGVjdE5ld0ltcG9ydHNUb0FjcXVpcmVUeXBlRm9yID0gYXN5bmMgKFxuICBzb3VyY2VDb2RlOiBzdHJpbmcsXG4gIHVzZXJBZGRMaWJyYXJ5VG9SdW50aW1lOiBBZGRMaWJUb1J1bnRpbWVGdW5jLFxuICBmZXRjaGVyID0gZmV0Y2gsXG4gIHBsYXlncm91bmRDb25maWc6IFBsYXlncm91bmRDb25maWdcbikgPT4ge1xuICAvLyBXcmFwIHRoZSBydW50aW1lIGZ1bmMgd2l0aCBvdXIgb3duIHNpZGUtZWZmZWN0IGZvciB2aXNpYmlsaXR5XG4gIGNvbnN0IGFkZExpYnJhcnlUb1J1bnRpbWUgPSAoY29kZTogc3RyaW5nLCBwYXRoOiBzdHJpbmcpID0+IHtcbiAgICBnbG9iYWxpc2hPYmoudHlwZURlZmluaXRpb25zW3BhdGhdID0gY29kZVxuICAgIHVzZXJBZGRMaWJyYXJ5VG9SdW50aW1lKGNvZGUsIHBhdGgpXG4gIH1cblxuICAvLyBCYXNpY2FsbHkgc3RhcnQgdGhlIHJlY3Vyc2lvbiB3aXRoIGFuIHVuZGVmaW5lZCBtb2R1bGVcbiAgY29uc3QgY29uZmlnOiBBVEFDb25maWcgPSB7IHNvdXJjZUNvZGUsIGFkZExpYnJhcnlUb1J1bnRpbWUsIGZldGNoZXIsIGxvZ2dlcjogcGxheWdyb3VuZENvbmZpZy5sb2dnZXIgfVxuICBjb25zdCByZXN1bHRzID0gZ2V0RGVwZW5kZW5jaWVzRm9yTW9kdWxlKHNvdXJjZUNvZGUsIHVuZGVmaW5lZCwgJ3BsYXlncm91bmQudHMnLCBjb25maWcpXG4gIHJldHVybiByZXN1bHRzXG59XG5cbi8qKlxuICogTG9va3MgYXQgYSBKUy9EVFMgZmlsZSBhbmQgcmVjdXJzZXMgdGhyb3VnaCBhbGwgdGhlIGRlcGVuZGVuY2llcy5cbiAqIEl0IGF2b2lkc1xuICovXG5jb25zdCBnZXREZXBlbmRlbmNpZXNGb3JNb2R1bGUgPSAoXG4gIHNvdXJjZUNvZGU6IHN0cmluZyxcbiAgbW9kdWxlTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICBwYXRoOiBzdHJpbmcsXG4gIGNvbmZpZzogQVRBQ29uZmlnXG4pID0+IHtcbiAgLy8gR2V0IGFsbCB0aGUgaW1wb3J0L3JlcXVpcmVzIGZvciB0aGUgZmlsZVxuICBjb25zdCBmaWx0ZXJlZE1vZHVsZXNUb0xvb2tBdCA9IHBhcnNlRmlsZUZvck1vZHVsZVJlZmVyZW5jZXMoc291cmNlQ29kZSlcbiAgZmlsdGVyZWRNb2R1bGVzVG9Mb29rQXQuZm9yRWFjaChhc3luYyBuYW1lID0+IHtcbiAgICAvLyBTdXBwb3J0IGdyYWJiaW5nIHRoZSBoYXJkLWNvZGVkIG5vZGUgbW9kdWxlcyBpZiBuZWVkZWRcbiAgICBjb25zdCBtb2R1bGVUb0Rvd25sb2FkID0gbWFwTW9kdWxlTmFtZVRvTW9kdWxlKG5hbWUpXG5cbiAgICBpZiAoIW1vZHVsZU5hbWUgJiYgbW9kdWxlVG9Eb3dubG9hZC5zdGFydHNXaXRoKCcuJykpIHtcbiAgICAgIHJldHVybiBjb25maWcubG9nZ2VyLmxvZyhcIltBVEFdIENhbid0IHJlc29sdmUgcmVsYXRpdmUgZGVwZW5kZW5jaWVzIGZyb20gdGhlIHBsYXlncm91bmQgcm9vdFwiKVxuICAgIH1cblxuICAgIGNvbnN0IG1vZHVsZUlEID0gY29udmVydFRvTW9kdWxlUmVmZXJlbmNlSUQobW9kdWxlTmFtZSEsIG1vZHVsZVRvRG93bmxvYWQsIG1vZHVsZU5hbWUhKVxuICAgIGlmIChhY3F1aXJlZFR5cGVEZWZzW21vZHVsZUlEXSB8fCBhY3F1aXJlZFR5cGVEZWZzW21vZHVsZUlEXSA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uZmlnLmxvZ2dlci5sb2coYFtBVEFdIExvb2tpbmcgYXQgJHttb2R1bGVUb0Rvd25sb2FkfWApXG5cbiAgICBjb25zdCBtb2RJc1Njb3BlZFBhY2thZ2VPbmx5ID0gbW9kdWxlVG9Eb3dubG9hZC5pbmRleE9mKCdAJykgPT09IDAgJiYgbW9kdWxlVG9Eb3dubG9hZC5zcGxpdCgnLycpLmxlbmd0aCA9PT0gMlxuICAgIGNvbnN0IG1vZElzUGFja2FnZU9ubHkgPSBtb2R1bGVUb0Rvd25sb2FkLmluZGV4T2YoJ0AnKSA9PT0gLTEgJiYgbW9kdWxlVG9Eb3dubG9hZC5zcGxpdCgnLycpLmxlbmd0aCA9PT0gMVxuICAgIGNvbnN0IGlzUGFja2FnZVJvb3RJbXBvcnQgPSBtb2RJc1BhY2thZ2VPbmx5IHx8IG1vZElzU2NvcGVkUGFja2FnZU9ubHlcbiAgICBjb25zdCBpc0Rlbm9Nb2R1bGUgPSBtb2R1bGVUb0Rvd25sb2FkLmluZGV4T2YoJ2h0dHBzOi8vJykgPT09IDBcblxuICAgIGlmIChpc1BhY2thZ2VSb290SW1wb3J0KSB7XG4gICAgICAvLyBTbyBpdCBkb2Vzbid0IHJ1biB0d2ljZSBmb3IgYSBwYWNrYWdlXG4gICAgICBhY3F1aXJlZFR5cGVEZWZzW21vZHVsZUlEXSA9IG51bGxcblxuICAgICAgLy8gRS5nLiBpbXBvcnQgZGFuZ2VyIGZyb20gXCJkYW5nZXJcIlxuICAgICAgY29uc3QgcGFja2FnZURlZiA9IGF3YWl0IGdldE1vZHVsZUFuZFJvb3REZWZUeXBlUGF0aChtb2R1bGVUb0Rvd25sb2FkLCBjb25maWcpXG5cbiAgICAgIGlmIChwYWNrYWdlRGVmKSB7XG4gICAgICAgIGFjcXVpcmVkVHlwZURlZnNbbW9kdWxlSURdID0gcGFja2FnZURlZi5wYWNrYWdlSlNPTlxuICAgICAgICBhd2FpdCBhZGRNb2R1bGVUb1J1bnRpbWUocGFja2FnZURlZi5tb2QsIHBhY2thZ2VEZWYucGF0aCwgY29uZmlnKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoaXNEZW5vTW9kdWxlKSB7XG4gICAgICAvLyBFLmcuIGltcG9ydCB7IHNlcnZlIH0gZnJvbSBcImh0dHBzOi8vZGVuby5sYW5kL3N0ZEB2MC4xMi9odHRwL3NlcnZlci50c1wiO1xuICAgICAgYXdhaXQgYWRkTW9kdWxlVG9SdW50aW1lKG1vZHVsZVRvRG93bmxvYWQsIG1vZHVsZVRvRG93bmxvYWQsIGNvbmZpZylcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRS5nLiBpbXBvcnQge0NvbXBvbmVudH0gZnJvbSBcIi4vTXlUaGluZ1wiXG4gICAgICBpZiAoIW1vZHVsZVRvRG93bmxvYWQgfHwgIXBhdGgpIHRocm93IGBObyBvdXRlciBtb2R1bGUgb3IgcGF0aCBmb3IgYSByZWxhdGl2ZSBpbXBvcnQ6ICR7bW9kdWxlVG9Eb3dubG9hZH1gXG5cbiAgICAgIGNvbnN0IGFic29sdXRlUGF0aEZvck1vZHVsZSA9IG1hcFJlbGF0aXZlUGF0aChtb2R1bGVUb0Rvd25sb2FkLCBwYXRoKVxuXG4gICAgICAvLyBTbyBpdCBkb2Vzbid0IHJ1biB0d2ljZSBmb3IgYSBwYWNrYWdlXG4gICAgICBhY3F1aXJlZFR5cGVEZWZzW21vZHVsZUlEXSA9IG51bGxcblxuICAgICAgY29uc3QgcmVzb2x2ZWRGaWxlcGF0aCA9IGFic29sdXRlUGF0aEZvck1vZHVsZS5lbmRzV2l0aCgnLnRzJylcbiAgICAgICAgPyBhYnNvbHV0ZVBhdGhGb3JNb2R1bGVcbiAgICAgICAgOiBhYnNvbHV0ZVBhdGhGb3JNb2R1bGUgKyAnLmQudHMnXG5cbiAgICAgIGF3YWl0IGFkZE1vZHVsZVRvUnVudGltZShtb2R1bGVOYW1lISwgcmVzb2x2ZWRGaWxlcGF0aCwgY29uZmlnKVxuICAgIH1cbiAgfSlcblxuICAvLyBBbHNvIHN1cHBvcnQgdGhlXG4gIGdldFJlZmVyZW5jZURlcGVuZGVuY2llcyhzb3VyY2VDb2RlLCBtb2R1bGVOYW1lISwgcGF0aCEsIGNvbmZpZylcbn1cbiJdfQ==