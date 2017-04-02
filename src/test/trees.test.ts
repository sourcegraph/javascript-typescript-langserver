
import * as chai from 'chai';
const assert = chai.assert;
import { HashNode, PathTree, SearchNode, UriTree } from '../trees';

describe('trees', () => {
	describe('UriTree', () => {
		describe('set()', () => {
			it('should add a file:// URL with content to the tree', () => {
				const tree = new UriTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('file:///foo/bar/baz.ts', content);
				assert.equal(tree.get('file:///foo/bar/baz.ts'), content);
			});
		});
		describe('hasPath()', () => {
			it('should return true if a URI exists in the tree with the given path', () => {
				const tree = new UriTree<void>();
				tree.set('file:///foo/bar/baz.ts', undefined);
				assert.equal(tree.hasPath('/foo/bar/baz.ts'), true);
			});
			it('should return false if no URI exists in the tree with the given path', () => {
				const tree = new UriTree<void>();
				tree.set('file:///foo/bar/baz.ts', undefined);
				assert.equal(tree.hasPath('/foo/bar/qux'), false);
			});
			it('should return false if only a directory exists in the tree with the given path', () => {
				const tree = new UriTree<void>();
				tree.set('file:///foo/bar/baz.ts', undefined);
				assert.equal(tree.hasPath('/foo/bar'), false);
			});
		});
		describe('getPath()', () => {
			it('should return the first value that matches the given path', () => {
				const tree = new UriTree<string>();
				tree.set('file:///foo/bar/baz.ts', 'BAZ');
				assert.equal(tree.getPath('/foo/bar/baz.ts'), 'BAZ');
			});
			it('should return undefined if no URI exists in the tree with the given path', () => {
				const tree = new UriTree<string>();
				tree.set('file:///foo/bar/baz.ts', 'BAZ');
				assert.equal(tree.getPath('/foo/bar/qux'), undefined);
			});
			it('should return undefined if only a directory exists in the tree with the given path', () => {
				const tree = new UriTree<string>();
				tree.set('file:///foo/bar/baz.ts', 'BAZ');
				assert.equal(tree.getPath('/foo/bar'), undefined);
			});
		});
		describe('getPathNode()', () => {
			it('should return the first PathNode that matches the given path', () => {
				const tree = new UriTree<string>();
				tree.set('file:///foo/bar/baz.ts', 'BAZ');
				const node = tree.getPathNode('/foo/bar');
				assert.isDefined(node);
				const searchNode = node!.get('baz.ts');
				assert.instanceOf(searchNode, SearchNode);
				const hashNode = (searchNode as SearchNode<string>).get(null);
				assert.instanceOf(hashNode, HashNode);
				const content = hashNode!.get(null);
				assert.equal(content, 'BAZ');
			});
			it('should return undefined if no URI exists in the tree with the given path', () => {
				const tree = new UriTree<string>();
				tree.set('file:///foo/bar/baz.ts', 'BAZ');
				assert.equal(tree.getPathNode('/foo/bar/qux'), undefined);
			});
		});
		describe('[Symbol.iterator]()', () => {
			it('should emit path, value pairs in level order', () => {
				const tree = new UriTree<string>();
				tree.set('file:///foo/bar/baz.txt', 'BAZ');
				tree.set('file:///foo/qux.txt', 'QUX');
				const iterator = tree[Symbol.iterator]();
				assert.deepEqual(iterator.next(), { done: false, value: ['file:///foo/qux.txt', 'QUX'] });
				assert.deepEqual(iterator.next(), { done: false, value: ['file:///foo/bar/baz.txt', 'BAZ'] });
				assert.deepEqual(iterator.next(), { done: true, value: undefined });
			});
		});
	});
	describe('PathTree', () => {
		describe('set()', () => {
			it('should add a file with content to the tree', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('/foo/bar/baz.ts', content);
				assert.equal(tree.get('/foo/bar/baz.ts'), content);
			});
			it('should throw when trying to add a file without name at the root level', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				assert.throws(() => {
					tree.set('/', content);
				});
			});
			it('should allow to override a directory with a file', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('/foo/bar/baz.ts', content);
				tree.set('/foo/bar', content);
				assert.equal(tree.get('/foo/bar'), content);
			});
			it('should throw when accessing a file as a directory', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('/foo/bar', content);
				assert.throws(() => {
					tree.set('/foo/bar/baz.ts', content);
				});
			});
			it('should add a file with content to the tree at root level', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('/bar.ts', content);
				assert.equal(tree.get('/bar.ts'), content);
			});
		});
		describe('getNode()', () => {
			it('should return the node at a path', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('/foo/bar/baz.ts', content);
				const barNode = tree.getNode('/foo/bar');
				assert.ok(barNode);
				const bazNode = barNode!.get('baz.ts');
				assert.equal(bazNode, content);
			});
			it('should return undefined if the path is not in the tree', () => {
				const tree = new PathTree<string>();
				const content = 'console.log("Hello World")';
				tree.set('/foo/bar/baz.ts', content);
				const barNode = tree.getNode('/qux/bar');
				assert.equal(barNode, undefined);
			});
		});
		describe('[Symbol.iterator]()', () => {
			it('should emit path, value pairs in level order', () => {
				const tree = new PathTree<string>();
				tree.set('/foo/bar/baz.txt', 'BAZ');
				tree.set('/foo/qux.txt', 'QUX');
				const iterator = tree[Symbol.iterator]();
				assert.deepEqual(iterator.next(), { done: false, value: ['/foo/qux.txt', 'QUX'] });
				assert.deepEqual(iterator.next(), { done: false, value: ['/foo/bar/baz.txt', 'BAZ'] });
				assert.deepEqual(iterator.next(), { done: true, value: undefined });
			});
		});
	});
});
