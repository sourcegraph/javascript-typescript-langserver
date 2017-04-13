import * as chai from 'chai';
import chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;
import { TypeScriptService } from '../typescript-service';
import { initializeTypeScriptService, shutdownTypeScriptService, TestContext } from './typescript-service-helpers';

describe('ProjectManager', () => {
	describe('getPackageName()', function (this: TestContext) {
		before(async function (this: TestContext) {
			await initializeTypeScriptService(
				(client, options) => new TypeScriptService(client, options),
				new Map([
					['file:///package.json', '{"name": "package-name-1"}'],
					['file:///subdirectory-with-tsconfig/package.json', '{"name": "package-name-2"}'],
					['file:///subdirectory-with-tsconfig/src/tsconfig.json', '{}'],
					['file:///subdirectory-with-tsconfig/src/dummy.ts', '']
				])).apply(this);
			await this.service.projectManager.ensureOwnFiles();
		} as any);
		after(shutdownTypeScriptService as any);
		it('should resolve package name when package.json is at the same level', function (this: TestContext) {
			assert.equal(this.service.projectManager.getConfiguration('').getPackageName(), 'package-name-1');
		} as any);
		it('should resolve package name when package.json is at the upper level', function (this: TestContext) {
			assert.equal(this.service.projectManager.getConfiguration('subdirectory-with-tsconfig/src/dummy.ts').getPackageName(), 'package-name-2');
		} as any);
	} as any);
});
