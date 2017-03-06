
import {describeTypeScriptService, TestContext} from './typescript-service-helpers';
import {TypeScriptService} from '../typescript-service';

describe('TypeScriptService', () => {

	beforeEach(<any>function (this: TestContext) {
		this.service = new TypeScriptService();
	});

	describeTypeScriptService();
});
