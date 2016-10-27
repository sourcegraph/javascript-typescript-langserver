/**
 * This file contains subset of functions copied over from src/compiler/sys.ts and src/compiler/core.ts of microsoft/typescript.
 * The purpose is to expose `matchFiles` helper function
 */

export interface FileSystemEntries {
    files: string[];
    directories: string[];
}

export function matchFiles(path: string, extensions: string[], excludes: string[], includes: string[], useCaseSensitiveFileNames: boolean, currentDirectory: string, getFileSystemEntries: (path: string) => FileSystemEntries): string[] {

    path = normalizePath(path);
    currentDirectory = normalizePath(currentDirectory);


    const patterns = getFileMatcherPatterns(path, extensions, excludes, includes, useCaseSensitiveFileNames, currentDirectory);


    const regexFlag = useCaseSensitiveFileNames ? "" : "i";

    const includeFileRegex = patterns.includeFilePattern && new RegExp(patterns.includeFilePattern, regexFlag);

    const includeDirectoryRegex = patterns.includeDirectoryPattern && new RegExp(patterns.includeDirectoryPattern, regexFlag);
    const excludeRegex = patterns.excludePattern && new RegExp(patterns.excludePattern, regexFlag);

    const result: string[] = [];
    for (const basePath of patterns.basePaths) {
        visitDirectory(basePath, combinePaths(currentDirectory, basePath));
    }
    return result;

    function visitDirectory(path: string, absolutePath: string) {
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

const directorySeparator = "/";

function combinePaths(path1: string, path2: string) {
    if (!(path1 && path1.length)) return path2;
    if (!(path2 && path2.length)) return path1;
    if (getRootLength(path2) !== 0) return path2;
    if (path1.charAt(path1.length - 1) === directorySeparator) return path1 + path2;
    return path1 + directorySeparator + path2;
}

function normalizePath(path: string): string {
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

function getFileMatcherPatterns(path: string, extensions: string[], excludes: string[], includes: string[], useCaseSensitiveFileNames: boolean, currentDirectory: string): FileMatcherPatterns {
    path = normalizePath(path);
    currentDirectory = normalizePath(currentDirectory);
    const absolutePath = combinePaths(currentDirectory, path);

    return {
        includeFilePattern: getRegularExpressionForWildcard(includes, absolutePath, "files"),
        includeDirectoryPattern: getRegularExpressionForWildcard(includes, absolutePath, "directories"),
        excludePattern: getRegularExpressionForWildcard(excludes, absolutePath, "exclude"),
        basePaths: getBasePaths(path, includes, useCaseSensitiveFileNames)
    };
}

function fileExtensionIs(path: string, extension: string): boolean {
    return path.length > extension.length && endsWith(path, extension);
}

function fileExtensionIsAny(path: string, extensions: string[]): boolean {
    for (const extension of extensions) {
        if (fileExtensionIs(path, extension)) {
            return true;
        }
    }

    return false;
}

function normalizeSlashes(path: string): string {
    return path.replace(/\\/g, "/");
}

function getRegularExpressionForWildcard(specs: string[], basePath: string, usage: "files" | "directories" | "exclude") {
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
                    if (component.charCodeAt(0) === CharacterCodes.asterisk) {
                        subpattern += "([^./]" + singleAsteriskRegexFragment + ")?";
                        component = component.substr(1);
                    }
                    else if (component.charCodeAt(0) === CharacterCodes.question) {
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


function getRootLength(path: string): number {
    if (path.charCodeAt(0) === CharacterCodes.slash) {
        if (path.charCodeAt(1) !== CharacterCodes.slash) return 1;
        const p1 = path.indexOf("/", 2);
        if (p1 < 0) return 2;
        const p2 = path.indexOf("/", p1 + 1);
        if (p2 < 0) return p1 + 1;
        return p2 + 1;
    }
    if (path.charCodeAt(1) === CharacterCodes.colon) {
        if (path.charCodeAt(2) === CharacterCodes.slash) return 3;
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

function getNormalizedParts(normalizedSlashedPath: string, rootLength: number): string[] {
    const parts = normalizedSlashedPath.substr(rootLength).split(directorySeparator);
    const normalized: string[] = [];
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

function pathEndsWithDirectorySeparator(path: string): boolean {
    return path.charCodeAt(path.length - 1) === directorySeparatorCharCode;
}

function replaceWildCardCharacterFiles(match: string) {
    return replaceWildcardCharacter(match, singleAsteriskRegexFragmentFiles);
}

function replaceWildCardCharacterOther(match: string) {
    return replaceWildcardCharacter(match, singleAsteriskRegexFragmentOther);
}

function replaceWildcardCharacter(match: string, singleAsteriskRegexFragment: string) {
    return match === "*" ? singleAsteriskRegexFragment : match === "?" ? "[^/]" : "\\" + match;
}

function getBasePaths(path: string, includes: string[], useCaseSensitiveFileNames: boolean) {
    // Storage for our results in the form of literal paths (e.g. the paths as written by the user).
    const basePaths: string[] = [path];
    if (includes) {
        // Storage for literal base paths amongst the include patterns.
        const includeBasePaths: string[] = [];
        for (const include of includes) {
            // We also need to check the relative paths by converting them to absolute and normalizing
            // in case they escape the base path (e.g "..\somedirectory")
            const absolute: string = isRootedDiskPath(include) ? include : normalizePath(combinePaths(path, include));

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

function endsWith(str: string, suffix: string): boolean {
    const expectedPos = str.length - suffix.length;
    return expectedPos >= 0 && str.indexOf(suffix, expectedPos) === expectedPos;
}

function compareStrings(a: string, b: string, ignoreCase?: boolean): Comparison {
    if (a === b) return Comparison.EqualTo;
    if (a === undefined) return Comparison.LessThan;
    if (b === undefined) return Comparison.GreaterThan;
    if (ignoreCase) {
        if (String.prototype.localeCompare) {
            const result = a.localeCompare(b, /*locales*/ undefined, { usage: "sort", sensitivity: "accent" });
            return result < 0 ? Comparison.LessThan : result > 0 ? Comparison.GreaterThan : Comparison.EqualTo;
        }

        a = a.toUpperCase();
        b = b.toUpperCase();
        if (a === b) return Comparison.EqualTo;
    }

    return a < b ? Comparison.LessThan : Comparison.GreaterThan;
}

function compareStringsCaseInsensitive(a: string, b: string) {
    return compareStrings(a, b, /*ignoreCase*/ true);
}

const singleAsteriskRegexFragmentFiles = "([^./]|(\\.(?!min\\.js$))?)*";
const singleAsteriskRegexFragmentOther = "[^/]*";

function getNormalizedPathComponents(path: string, currentDirectory: string) {
    path = normalizeSlashes(path);
    let rootLength = getRootLength(path);
    if (rootLength === 0) {
        // If the path is not rooted it is relative to current directory
        path = combinePaths(normalizeSlashes(currentDirectory), path);
        rootLength = getRootLength(path);
    }

    return normalizedPathComponents(path, rootLength);
}

function normalizedPathComponents(path: string, rootLength: number) {
    const normalizedParts = getNormalizedParts(path, rootLength);
    return [path.substr(0, rootLength)].concat(normalizedParts);
}

function containsPath(parent: string, child: string, currentDirectory: string, ignoreCase?: boolean) {
    if (parent === undefined || child === undefined) return false;
    if (parent === child) return true;
    parent = removeTrailingDirectorySeparator(parent);
    child = removeTrailingDirectorySeparator(child);
    if (parent === child) return true;
    const parentComponents = getNormalizedPathComponents(parent, currentDirectory);
    const childComponents = getNormalizedPathComponents(child, currentDirectory);
    if (childComponents.length < parentComponents.length) {
        return false;
    }

    for (let i = 0; i < parentComponents.length; i++) {
        const result = compareStrings(parentComponents[i], childComponents[i], ignoreCase);
        if (result !== Comparison.EqualTo) {
            return false;
        }
    }

    return true;
}

function removeTrailingDirectorySeparator(path: string) {
    if (path.charAt(path.length - 1) === directorySeparator) {
        return path.substr(0, path.length - 1);
    }

    return path;
}

function lastOrUndefined<T>(array: T[]): T {
    return array && array.length > 0
        ? array[array.length - 1]
        : undefined;
}

interface FileMatcherPatterns {
    includeFilePattern: string;
    includeDirectoryPattern: string;
    excludePattern: string;
    basePaths: string[];
}

const enum Comparison {
    LessThan = -1,
    EqualTo = 0,
    GreaterThan = 1
}

const enum CharacterCodes {
    nullCharacter = 0,
    maxAsciiCharacter = 0x7F,

    lineFeed = 0x0A,              // \n
    carriageReturn = 0x0D,        // \r
    lineSeparator = 0x2028,
    paragraphSeparator = 0x2029,
    nextLine = 0x0085,

    // Unicode 3.0 space characters
    space = 0x0020,   // " "
    nonBreakingSpace = 0x00A0,   //
    enQuad = 0x2000,
    emQuad = 0x2001,
    enSpace = 0x2002,
    emSpace = 0x2003,
    threePerEmSpace = 0x2004,
    fourPerEmSpace = 0x2005,
    sixPerEmSpace = 0x2006,
    figureSpace = 0x2007,
    punctuationSpace = 0x2008,
    thinSpace = 0x2009,
    hairSpace = 0x200A,
    zeroWidthSpace = 0x200B,
    narrowNoBreakSpace = 0x202F,
    ideographicSpace = 0x3000,
    mathematicalSpace = 0x205F,
    ogham = 0x1680,

    _ = 0x5F,
    $ = 0x24,

    _0 = 0x30,
    _1 = 0x31,
    _2 = 0x32,
    _3 = 0x33,
    _4 = 0x34,
    _5 = 0x35,
    _6 = 0x36,
    _7 = 0x37,
    _8 = 0x38,
    _9 = 0x39,

    a = 0x61,
    b = 0x62,
    c = 0x63,
    d = 0x64,
    e = 0x65,
    f = 0x66,
    g = 0x67,
    h = 0x68,
    i = 0x69,
    j = 0x6A,
    k = 0x6B,
    l = 0x6C,
    m = 0x6D,
    n = 0x6E,
    o = 0x6F,
    p = 0x70,
    q = 0x71,
    r = 0x72,
    s = 0x73,
    t = 0x74,
    u = 0x75,
    v = 0x76,
    w = 0x77,
    x = 0x78,
    y = 0x79,
    z = 0x7A,

    A = 0x41,
    B = 0x42,
    C = 0x43,
    D = 0x44,
    E = 0x45,
    F = 0x46,
    G = 0x47,
    H = 0x48,
    I = 0x49,
    J = 0x4A,
    K = 0x4B,
    L = 0x4C,
    M = 0x4D,
    N = 0x4E,
    O = 0x4F,
    P = 0x50,
    Q = 0x51,
    R = 0x52,
    S = 0x53,
    T = 0x54,
    U = 0x55,
    V = 0x56,
    W = 0x57,
    X = 0x58,
    Y = 0x59,
    Z = 0x5a,

    ampersand = 0x26,             // &
    asterisk = 0x2A,              // *
    at = 0x40,                    // @
    backslash = 0x5C,             // \
    backtick = 0x60,              // `
    bar = 0x7C,                   // |
    caret = 0x5E,                 // ^
    closeBrace = 0x7D,            // }
    closeBracket = 0x5D,          // ]
    closeParen = 0x29,            // )
    colon = 0x3A,                 // :
    comma = 0x2C,                 // ,
    dot = 0x2E,                   // .
    doubleQuote = 0x22,           // "
    equals = 0x3D,                // =
    exclamation = 0x21,           // !
    greaterThan = 0x3E,           // >
    hash = 0x23,                  // #
    lessThan = 0x3C,              // <
    minus = 0x2D,                 // -
    openBrace = 0x7B,             // {
    openBracket = 0x5B,           // [
    openParen = 0x28,             // (
    percent = 0x25,               // %
    plus = 0x2B,                  // +
    question = 0x3F,              // ?
    semicolon = 0x3B,             // ;
    singleQuote = 0x27,           // '
    slash = 0x2F,                 // /
    tilde = 0x7E,                 // ~

    backspace = 0x08,             // \b
    formFeed = 0x0C,              // \f
    byteOrderMark = 0xFEFF,
    tab = 0x09,                   // \t
    verticalTab = 0x0B,           // \v
}

const reservedCharacterPattern = /[^\w\s\/]/g;

const directorySeparatorCharCode = CharacterCodes.slash;

function isRootedDiskPath(path: string) {
    return getRootLength(path) !== 0;
}

function indexOfAnyCharCode(text: string, charCodes: number[], start?: number): number {
    for (let i = start || 0, len = text.length; i < len; i++) {
        if (contains(charCodes, text.charCodeAt(i))) {
            return i;
        }
    }
    return -1;
}

const wildcardCharCodes = [CharacterCodes.asterisk, CharacterCodes.question];

function getDirectoryPath(path: string): any {
    return path.substr(0, Math.max(getRootLength(path), path.lastIndexOf(directorySeparator)));
}

function contains<T>(array: T[], value: T): boolean {
    if (array) {
        for (const v of array) {
            if (v === value) {
                return true;
            }
        }
    }
    return false;
}
