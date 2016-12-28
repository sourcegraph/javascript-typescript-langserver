/**
 * This file contains subset of functions copied over from src/compiler/sys.ts and src/compiler/core.ts of microsoft/typescript.
 * The purpose is to expose `matchFiles` helper function
 */
"use strict";
function matchFiles(path, extensions, excludes, includes, useCaseSensitiveFileNames, currentDirectory, getFileSystemEntries) {
    path = normalizePath(path);
    currentDirectory = normalizePath(currentDirectory);
    const patterns = getFileMatcherPatterns(path, extensions, excludes, includes, useCaseSensitiveFileNames, currentDirectory);
    const regexFlag = useCaseSensitiveFileNames ? "" : "i";
    const includeFileRegex = patterns.includeFilePattern && new RegExp(patterns.includeFilePattern, regexFlag);
    const includeDirectoryRegex = patterns.includeDirectoryPattern && new RegExp(patterns.includeDirectoryPattern, regexFlag);
    const excludeRegex = patterns.excludePattern && new RegExp(patterns.excludePattern, regexFlag);
    const result = [];
    for (const basePath of patterns.basePaths) {
        visitDirectory(basePath, combinePaths(currentDirectory, basePath));
    }
    return result;
    function visitDirectory(path, absolutePath) {
        const { files, directories } = getFileSystemEntries(path);
        for (const current of files) {
            const name = combinePaths(path, current);
            const absoluteName = combinePaths(absolutePath, current);
            if ((!extensions || fileExtensionIsAny(name, extensions)) &&
                (!includeFileRegex || includeFileRegex.test(absoluteName)) &&
                (!excludeRegex || !excludeRegex.test(absoluteName))) {
                result.push(name);
            }
        }
        for (const current of directories) {
            const name = combinePaths(path, current);
            const absoluteName = combinePaths(absolutePath, current);
            if ((!includeDirectoryRegex || includeDirectoryRegex.test(absoluteName)) &&
                (!excludeRegex || !excludeRegex.test(absoluteName))) {
                visitDirectory(name, absoluteName);
            }
        }
    }
}
exports.matchFiles = matchFiles;
const directorySeparator = "/";
function combinePaths(path1, path2) {
    if (!(path1 && path1.length))
        return path2;
    if (!(path2 && path2.length))
        return path1;
    if (getRootLength(path2) !== 0)
        return path2;
    if (path1.charAt(path1.length - 1) === directorySeparator)
        return path1 + path2;
    return path1 + directorySeparator + path2;
}
function normalizePath(path) {
    path = normalizeSlashes(path);
    const rootLength = getRootLength(path);
    const root = path.substr(0, rootLength);
    const normalized = getNormalizedParts(path, rootLength);
    if (normalized.length) {
        const joinedParts = root + normalized.join(directorySeparator);
        return pathEndsWithDirectorySeparator(path) ? joinedParts + directorySeparator : joinedParts;
    }
    else {
        return root;
    }
}
function getFileMatcherPatterns(path, extensions, excludes, includes, useCaseSensitiveFileNames, currentDirectory) {
    path = normalizePath(path);
    currentDirectory = normalizePath(currentDirectory);
    const absolutePath = combinePaths(currentDirectory, path);
    return {
        includeFilePattern: getRegularExpressionForWildcard(includes, absolutePath, "files") || "",
        includeDirectoryPattern: getRegularExpressionForWildcard(includes, absolutePath, "directories") || "",
        excludePattern: getRegularExpressionForWildcard(excludes, absolutePath, "exclude") || "",
        basePaths: getBasePaths(path, includes, useCaseSensitiveFileNames) || [],
    };
}
function fileExtensionIs(path, extension) {
    return path.length > extension.length && endsWith(path, extension);
}
function fileExtensionIsAny(path, extensions) {
    for (const extension of extensions) {
        if (fileExtensionIs(path, extension)) {
            return true;
        }
    }
    return false;
}
function getRegularExpressionForWildcard(specs, basePath, usage) {
    if (specs === undefined || specs.length === 0) {
        return undefined;
    }
    const replaceWildcardCharacter = usage === "files" ? replaceWildCardCharacterFiles : replaceWildCardCharacterOther;
    const singleAsteriskRegexFragment = usage === "files" ? singleAsteriskRegexFragmentFiles : singleAsteriskRegexFragmentOther;
    /**
     * Regex for the ** wildcard. Matches any number of subdirectories. When used for including
     * files or directories, does not match subdirectories that start with a . character
     */
    const doubleAsteriskRegexFragment = usage === "exclude" ? "(/.+?)?" : "(/[^/.][^/]*)*?";
    let pattern = "";
    let hasWrittenSubpattern = false;
    spec: for (const spec of specs) {
        if (!spec) {
            continue;
        }
        let subpattern = "";
        let hasRecursiveDirectoryWildcard = false;
        let hasWrittenComponent = false;
        const components = getNormalizedPathComponents(spec, basePath);
        if (usage !== "exclude" && components[components.length - 1] === "**") {
            continue spec;
        }
        // getNormalizedPathComponents includes the separator for the root component.
        // We need to remove to create our regex correctly.
        components[0] = removeTrailingDirectorySeparator(components[0]);
        let optionalCount = 0;
        for (let component of components) {
            if (component === "**") {
                if (hasRecursiveDirectoryWildcard) {
                    continue spec;
                }
                subpattern += doubleAsteriskRegexFragment;
                hasRecursiveDirectoryWildcard = true;
                hasWrittenComponent = true;
            }
            else {
                if (usage === "directories") {
                    subpattern += "(";
                    optionalCount++;
                }
                if (hasWrittenComponent) {
                    subpattern += directorySeparator;
                }
                if (usage !== "exclude") {
                    // The * and ? wildcards should not match directories or files that start with . if they
                    // appear first in a component. Dotted directories and files can be included explicitly
                    // like so: **/.*/.*
                    if (component.charCodeAt(0) === 42 /* asterisk */) {
                        subpattern += "([^./]" + singleAsteriskRegexFragment + ")?";
                        component = component.substr(1);
                    }
                    else if (component.charCodeAt(0) === 63 /* question */) {
                        subpattern += "[^./]";
                        component = component.substr(1);
                    }
                }
                subpattern += component.replace(reservedCharacterPattern, replaceWildcardCharacter);
                hasWrittenComponent = true;
            }
        }
        while (optionalCount > 0) {
            subpattern += ")?";
            optionalCount--;
        }
        if (hasWrittenSubpattern) {
            pattern += "|";
        }
        pattern += "(" + subpattern + ")";
        hasWrittenSubpattern = true;
    }
    if (!pattern) {
        return undefined;
    }
    return "^(" + pattern + (usage === "exclude" ? ")($|/)" : ")$");
}
function getRootLength(path) {
    if (path.charCodeAt(0) === 47 /* slash */) {
        if (path.charCodeAt(1) !== 47 /* slash */)
            return 1;
        const p1 = path.indexOf("/", 2);
        if (p1 < 0)
            return 2;
        const p2 = path.indexOf("/", p1 + 1);
        if (p2 < 0)
            return p1 + 1;
        return p2 + 1;
    }
    if (path.charCodeAt(1) === 58 /* colon */) {
        if (path.charCodeAt(2) === 47 /* slash */)
            return 3;
        return 2;
    }
    // Per RFC 1738 'file' URI schema has the shape file://<host>/<path>
    // if <host> is omitted then it is assumed that host value is 'localhost',
    // however slash after the omitted <host> is not removed.
    // file:///folder1/file1 - this is a correct URI
    // file://folder2/file2 - this is an incorrect URI
    if (path.lastIndexOf("file:///", 0) === 0) {
        return "file:///".length;
    }
    const idx = path.indexOf("://");
    if (idx !== -1) {
        return idx + "://".length;
    }
    return 0;
}
function getNormalizedParts(normalizedSlashedPath, rootLength) {
    const parts = normalizedSlashedPath.substr(rootLength).split(directorySeparator);
    const normalized = [];
    for (const part of parts) {
        if (part !== ".") {
            if (part === ".." && normalized.length > 0 && lastOrUndefined(normalized) !== "..") {
                normalized.pop();
            }
            else {
                // A part may be an empty string (which is 'falsy') if the path had consecutive slashes,
                // e.g. "path//file.ts".  Drop these before re-joining the parts.
                if (part) {
                    normalized.push(part);
                }
            }
        }
    }
    return normalized;
}
function pathEndsWithDirectorySeparator(path) {
    return path.charCodeAt(path.length - 1) === directorySeparatorCharCode;
}
function replaceWildCardCharacterFiles(match) {
    return replaceWildcardCharacter(match, singleAsteriskRegexFragmentFiles);
}
function replaceWildCardCharacterOther(match) {
    return replaceWildcardCharacter(match, singleAsteriskRegexFragmentOther);
}
function replaceWildcardCharacter(match, singleAsteriskRegexFragment) {
    return match === "*" ? singleAsteriskRegexFragment : match === "?" ? "[^/]" : "\\" + match;
}
function getBasePaths(path, includes, useCaseSensitiveFileNames) {
    // Storage for our results in the form of literal paths (e.g. the paths as written by the user).
    const basePaths = [path];
    if (includes) {
        // Storage for literal base paths amongst the include patterns.
        const includeBasePaths = [];
        for (const include of includes) {
            // We also need to check the relative paths by converting them to absolute and normalizing
            // in case they escape the base path (e.g "..\somedirectory")
            const absolute = isRootedDiskPath(include) ? include : normalizePath(combinePaths(path, include));
            const wildcardOffset = indexOfAnyCharCode(absolute, wildcardCharCodes);
            const includeBasePath = wildcardOffset < 0
                ? removeTrailingDirectorySeparator(getDirectoryPath(absolute))
                : absolute.substring(0, absolute.lastIndexOf(directorySeparator, wildcardOffset));
            // Append the literal and canonical candidate base paths.
            includeBasePaths.push(includeBasePath);
        }
        // Sort the offsets array using either the literal or canonical path representations.
        includeBasePaths.sort(useCaseSensitiveFileNames ? compareStrings : compareStringsCaseInsensitive);
        // Iterate over each include base path and include unique base paths that are not a
        // subpath of an existing base path
        include: for (let i = 0; i < includeBasePaths.length; i++) {
            const includeBasePath = includeBasePaths[i];
            for (let j = 0; j < basePaths.length; j++) {
                if (containsPath(basePaths[j], includeBasePath, path, !useCaseSensitiveFileNames)) {
                    continue include;
                }
            }
            basePaths.push(includeBasePath);
        }
    }
    return basePaths;
}
function endsWith(str, suffix) {
    const expectedPos = str.length - suffix.length;
    return expectedPos >= 0 && str.indexOf(suffix, expectedPos) === expectedPos;
}
function compareStrings(a, b, ignoreCase) {
    if (a === b)
        return 0 /* EqualTo */;
    if (a === undefined)
        return -1 /* LessThan */;
    if (b === undefined)
        return 1 /* GreaterThan */;
    if (ignoreCase) {
        if (String.prototype.localeCompare) {
            const result = a.localeCompare(b, /*locales*/ undefined, { usage: "sort", sensitivity: "accent" });
            return result < 0 ? -1 /* LessThan */ : result > 0 ? 1 /* GreaterThan */ : 0 /* EqualTo */;
        }
        a = a.toUpperCase();
        b = b.toUpperCase();
        if (a === b)
            return 0 /* EqualTo */;
    }
    return a < b ? -1 /* LessThan */ : 1 /* GreaterThan */;
}
function compareStringsCaseInsensitive(a, b) {
    return compareStrings(a, b, /*ignoreCase*/ true);
}
const singleAsteriskRegexFragmentFiles = "([^./]|(\\.(?!min\\.js$))?)*";
const singleAsteriskRegexFragmentOther = "[^/]*";
function getNormalizedPathComponents(path, currentDirectory) {
    path = normalizeSlashes(path);
    let rootLength = getRootLength(path);
    if (rootLength === 0) {
        // If the path is not rooted it is relative to current directory
        path = combinePaths(normalizeSlashes(currentDirectory), path);
        rootLength = getRootLength(path);
    }
    return normalizedPathComponents(path, rootLength);
}
function normalizedPathComponents(path, rootLength) {
    const normalizedParts = getNormalizedParts(path, rootLength);
    return [path.substr(0, rootLength)].concat(normalizedParts);
}
function containsPath(parent, child, currentDirectory, ignoreCase) {
    if (parent === undefined || child === undefined)
        return false;
    if (parent === child)
        return true;
    parent = removeTrailingDirectorySeparator(parent);
    child = removeTrailingDirectorySeparator(child);
    if (parent === child)
        return true;
    const parentComponents = getNormalizedPathComponents(parent, currentDirectory);
    const childComponents = getNormalizedPathComponents(child, currentDirectory);
    if (childComponents.length < parentComponents.length) {
        return false;
    }
    for (let i = 0; i < parentComponents.length; i++) {
        const result = compareStrings(parentComponents[i], childComponents[i], ignoreCase);
        if (result !== 0 /* EqualTo */) {
            return false;
        }
    }
    return true;
}
function removeTrailingDirectorySeparator(path) {
    if (path.charAt(path.length - 1) === directorySeparator) {
        return path.substr(0, path.length - 1);
    }
    return path;
}
function lastOrUndefined(array) {
    return array && array.length > 0
        ? array[array.length - 1]
        : undefined;
}
const reservedCharacterPattern = /[^\w\s\/]/g;
const directorySeparatorCharCode = 47 /* slash */;
function isRootedDiskPath(path) {
    return getRootLength(path) !== 0;
}
function indexOfAnyCharCode(text, charCodes, start) {
    for (let i = start || 0, len = text.length; i < len; i++) {
        if (contains(charCodes, text.charCodeAt(i))) {
            return i;
        }
    }
    return -1;
}
const wildcardCharCodes = [42 /* asterisk */, 63 /* question */];
function getDirectoryPath(path) {
    return path.substr(0, Math.max(getRootLength(path), path.lastIndexOf(directorySeparator)));
}
function contains(array, value) {
    if (array) {
        for (const v of array) {
            if (v === value) {
                return true;
            }
        }
    }
    return false;
}
function normalizeSlashes(path) {
    return path.replace(/\\/g, "/");
}
//# sourceMappingURL=match-files.js.map