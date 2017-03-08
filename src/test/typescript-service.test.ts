
import {TypeScriptService} from '../typescript-service';
import {describeTypeScriptService, TestContext} from './typescript-service-helpers';

describe('TypeScriptService', () => {

	beforeEach(<any> function (this: TestContext) {
		this.service = new TypeScriptService();
	});

	describeTypeScriptService();
});
