import * as chai from 'chai';
import * as sinon from 'Sinon';
import glob = require('glob');
import { RemoteLanguageClient } from '../lang-handler';
import { TypeScriptService } from '../typescript-service';
import { path2uri } from '../util';
import chaiAsPromised = require('chai-as-promised');
import { LocalFileSystem } from '../fs';
chai.use(chaiAsPromised);
const assert = chai.assert;

describe.only('running against this project', () => {
	let client: any;
	let service: any;
	let rootUri: string;

	const rootPath = process.cwd();
	const filePaths = glob.sync('src/*.ts');

	before(async () => {
		client = sinon.createStubInstance(RemoteLanguageClient);

		rootUri = path2uri('', rootPath) + '/';

		service = new TypeScriptService(client, {strict: false, traceModuleResolution: false});
		await service.initialize({
			processId: process.pid,
			rootUri,
			capabilities: {}
		}).toPromise();
	});

	for (const filePath of filePaths) {
		it('should get no diagnostics on didOpen ' + filePath, async () => {
			const fileUri = path2uri(rootPath, filePath);
			const fs = new LocalFileSystem(rootPath);
			const fileContent = await fs.getTextDocumentContent(fileUri);

			assert.isAtLeast(fileContent.length, 1);

			const resp = await service.textDocumentDidOpen({
				textDocument: {
					uri: fileUri,
					languageId: 'typescript',
					version: 1,
					text: fileContent
				}
			});
			sinon.assert.calledWithExactly(client.textDocumentPublishDiagnostics,
			{
				diagnostics: [],
				uri: fileUri
			});
			return resp;
		});
	}
});
