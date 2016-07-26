/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

var net = require('net');
var fs = require('fs');
import * as ts from "typescript";

import {
	createConnection, IConnection,
	InitializeParams, InitializeResult,
	TextDocuments,
	TextDocumentPositionParams, Definition, ReferenceParams, Location, Hover
} from 'vscode-languageserver';

var services: ts.LanguageService = null;

function startLanguageService(rootFileNames: string[], options: ts.CompilerOptions) {

    const files: ts.Map<{ version: number }> = {};

    // initialize the list of files
    rootFileNames.forEach(fileName => {
        files[fileName] = { version: 0 };
    });

    // Create the language service host to allow the LS to communicate with the host
    const servicesHost: ts.LanguageServiceHost = {
        getScriptFileNames: () => rootFileNames,
        getScriptVersion: (fileName) => files[fileName] && files[fileName].version.toString(),
        getScriptSnapshot: (fileName) => {
            if (!fs.existsSync(fileName)) {
                return undefined;
            }
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        },
        getCurrentDirectory: () => process.cwd(),
        getCompilationSettings: () => options,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    };

    // Create the language service files
    services = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
}

var server = net.createServer(function (socket) {
	let connection: IConnection = createConnection(socket, socket);
	let documents: TextDocuments = new TextDocuments();

    connection.onInitialize((params: InitializeParams): InitializeResult => {
		console.log("initialize");
		// TODO: create typescript object ....
		// Initialize files constituting the program as all .ts files in the current directory
		const projectFiles = fs.readdirSync(params.rootPath).
			filter(fileName => fileName.length >= 3 && fileName.substr(fileName.length - 3, 3) === ".ts");
		//TODO read from initialize?	
		const options: ts.CompilerOptions = { module: ts.ModuleKind.CommonJS };
		startLanguageService(projectFiles, options);
		return {
			capabilities: {
				// Tell the client that the server works in FULL text document sync mode
				textDocumentSync: documents.syncKind,
				hoverProvider: true,
				definitionProvider: true,
				referencesProvider: true
			}
		}
    });

    connection.onDefinition((params: TextDocumentPositionParams): Definition => {
		console.log("definition");
		//TODO find out filename from uri and position from character and line
		let defInfos: ts.DefinitionInfo[] = services.getDefinitionAtPosition(params.textDocument.uri, params.position.character);
		let result: Location[] = [];
		for (let defInfo of defInfos) {
			result.push(Location.create(defInfo.fileName, {
				//TODO convert defInfo.textSpan into start and end positions
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 }
			}));
		}
		return result;
    });

    connection.onHover((params: TextDocumentPositionParams): Hover => {
		return {
			contents: []
		};
    });
    connection.onReferences((params: ReferenceParams): Location[] => {
		return [];
    });
    connection.listen();
});

server.listen(2088, '127.0.0.1');