import * as assert from 'assert';
import { URL } from 'whatwg-url';
import { path2uri, symbolDescriptorMatch, uri2path } from '../util';

describe('util', () => {
	describe('path2uri()', () => {
		it('should convert a Unix file path to a URI', () => {
			const uri = path2uri(new URL('file:///foo/bar'), '/baz/qux');
			assert.equal(uri.href, 'file:///baz/qux');
		});
		it('should convert a Windows file path to a URI', () => {
			const uri = path2uri(new URL('file:///foo/bar'), 'C:\\baz\\qux');
			assert.equal(uri.href, 'file:///C:/baz/qux');
		});
		it('should encode special characters', () => {
			const uri = path2uri(new URL('file:///foo/bar'), '/💩');
			assert.equal(uri.href, 'file:///%F0%9F%92%A9');
		});
		it('should encode unreserved special characters', () => {
			const uri = path2uri(new URL('file:///foo/bar'), '/@baz');
			assert.equal(uri.href, 'file:///%40baz');
		});
	});
	describe('uri2path()', () => {
		it('should convert a Unix file URI to a file path', () => {
			const filePath = uri2path(new URL('file:///baz/qux'));
			assert.equal(filePath, '/baz/qux');
		});
		it('should convert a Windows file URI to a file path', () => {
			const filePath = uri2path(new URL('file:///c:/baz/qux'));
			assert.equal(filePath, 'c:\\baz\\qux');
		});
		it('should convert a Windows file URI with uppercase drive letter to a file path', () => {
			const filePath = uri2path(new URL('file:///C:/baz/qux'));
			assert.equal(filePath, 'C:\\baz\\qux');
		});
		it('should decode special characters', () => {
			const filePath = uri2path(new URL('file:///%F0%9F%92%A9'));
			assert.equal(filePath, '/💩');
		});
		it('should decode unreserved special characters', () => {
			const filePath = uri2path(new URL('file:///%40foo'));
			assert.equal(filePath, '/@foo');
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
