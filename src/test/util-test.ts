import * as assert from 'assert';
import { isGlobalTSFile, isSymbolDescriptorMatch } from '../util';

describe('util', () => {
	describe('isSymbolDescriptorMatch()', () => {
		it('should return true for a matching query', () => {
			const matches = isSymbolDescriptorMatch({
				containerKind: undefined,
				containerName: 'ts',
				kind: 'interface',
				name: 'Program',
				package: undefined
			}, {
				containerKind: 'module',
				containerName: 'ts',
				kind: 'interface',
				name: 'Program',
				package: undefined
			});
			assert.equal(matches, true);
		});
		it('should return true for a matching query with PackageDescriptor', () => {
			const matches = isSymbolDescriptorMatch({
				name: 'a',
				kind: 'class',
				package: { name: 'mypkg' },
				containerKind: undefined
			}, {
				kind: 'class',
				name: 'a',
				containerKind: '',
				containerName: '',
				package: { name: 'mypkg' }
			});
			assert.equal(matches, true);
		});
	});
	describe('isGlobalTSFile()', () => {
		it('should match declaration files in node_modules', () => {
			assert.equal(isGlobalTSFile('/node_modules/@types/not_node/not_node.d.ts'), true);
		});
		it('should match the synthetic reference to tsdlib when using importHelpers', () => {
			assert.equal(isGlobalTSFile('/node_modules/tslib/tslib.d.ts'), true);
		});
	});
});
