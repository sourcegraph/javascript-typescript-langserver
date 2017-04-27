import * as assert from 'assert';
import { URL } from 'whatwg-url';
import { path2uri, symbolDescriptorMatch, uri2path } from '../util';

describe('util', () => {
	describe('path2uri()', () => {
		it('should convert a Unix file path to a URI', () => {
			const uri = path2uri(new URL('file://host/foo/bar'), '/baz/@qux');
			assert.equal(uri.href, 'file://host/baz/%40qux');
		});
		it('should convert a Windows file path to a URI', () => {
			// Host is dropped because of https://github.com/jsdom/whatwg-url/issues/84
			const uri = path2uri(new URL('file:///foo/bar'), 'C:\\baz\\@qux');
			assert.equal(uri.href, 'file:///C:/baz/%40qux');
		});
	});
	describe('uri2path()', () => {
		it('should convert a Unix file URI to a file path', () => {
			const filePath = uri2path(new URL('file:///baz/%40qux'));
			assert.equal(filePath, '/baz/@qux');
		});
		it('should convert a Windows file URI to a file path', () => {
			const filePath = uri2path(new URL('file:///c:/baz/%40qux'));
			assert.equal(filePath, 'c:\\baz\\@qux');
		});
	});
	describe('symbolDescriptorMatch', () => {
		it('', (done: (err?: Error) => void) => {
			const want = true;
			const got = symbolDescriptorMatch({
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
			if (want !== got) {
				done(new Error('wanted ' + want + ', but got ' + got));
				return;
			}
			done();
		});
		it('', (done: (err?: Error) => void) => {
			const want = true;
			const got = symbolDescriptorMatch({
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
			if (want !== got) {
				done(new Error('wanted ' + want + ', but got ' + got));
				return;
			}
			done();
		});
	});
});
