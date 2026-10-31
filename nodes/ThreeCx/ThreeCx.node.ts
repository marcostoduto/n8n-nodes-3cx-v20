import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import {
	CREDENTIAL_NAME,
	odataString,
	parseInterfaceLink,
	toObject,
	xapiGetAll,
	xapiRequest,
} from './GenericFunctions';

const getAllResources = ['sipDevice', 'user', 'group'];

export class ThreeCx implements INodeType {
	description: INodeTypeDescription = {
		displayName: '3CX v20',
		name: 'threeCxV20',
		icon: 'file:threecx.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] === "custom" ? $parameter["method"] + " " + $parameter["endpoint"] : $parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Configuration API (XAPI) di 3CX v20 con login a token',
		defaults: { name: '3CX v20' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: CREDENTIAL_NAME, required: true }],
		properties: [
			// ------------------------------------------------------------------ resource
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'SIP Device (Telefono)', value: 'sipDevice' },
					{ name: 'User (Interno)', value: 'user' },
					{ name: 'Group (Reparto)', value: 'group' },
					{ name: 'System', value: 'system' },
					{ name: 'Custom XAPI Request', value: 'custom' },
				],
				default: 'sipDevice',
			},

			// ------------------------------------------------------------------ operations
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['sipDevice'] } },
				options: [
					{ name: 'Get by Extension', value: 'get', action: 'Get a SIP device by extension number', description: 'Come PhoneApi.getphone(): primo dispositivo con DN/Number = interno' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many SIP devices' },
				],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['user'] } },
				options: [
					{ name: 'Get by Number', value: 'get', action: 'Get a user by extension number' },
					{ name: 'Get by ID', value: 'getById', action: 'Get a user by ID' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many users' },
					{ name: 'Update', value: 'update', action: 'Update a user' },
				],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['group'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get a group' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many groups' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['system'] } },
				options: [
					{ name: 'Get Status', value: 'getStatus', action: 'Get system status', description: 'GET /xapi/v1/SystemStatus' },
					{ name: 'Get Version', value: 'getVersion', action: 'Get the 3CX version', description: 'Legge l\'header X-3CX-Version (verifica anche il login)' },
				],
				default: 'getStatus',
			},

			// ------------------------------------------------------------------ SIP device
			{
				displayName: 'Extension Number',
				name: 'extensionNumber',
				type: 'string',
				required: true,
				default: '',
				placeholder: '101',
				displayOptions: { show: { resource: ['sipDevice'], operation: ['get'] } },
			},
			{
				displayName: 'Vendor',
				name: 'vendor',
				type: 'string',
				default: '',
				placeholder: 'Fanvil',
				description: 'Filtra su Registrar/Vendor (es. Fanvil). Vuoto = tutti i produttori.',
				displayOptions: { show: { resource: ['sipDevice'] } },
			},
			{
				displayName: 'Parse Interface Link',
				name: 'parseInterfaceLink',
				type: 'boolean',
				default: true,
				description: 'Whether to add an "interface" field with ip, username and password taken from Registrar.InterfaceLink',
				displayOptions: { show: { resource: ['sipDevice'] } },
			},

			// ------------------------------------------------------------------ user
			{
				displayName: 'Extension Number',
				name: 'number',
				type: 'string',
				required: true,
				default: '',
				placeholder: '101',
				displayOptions: { show: { resource: ['user'], operation: ['get'] } },
			},
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['user'], operation: ['getById', 'update'] } },
			},
			{
				displayName: 'Fields to Update (JSON)',
				name: 'updateFields',
				type: 'json',
				required: true,
				default: '{\n  "FirstName": "Mario"\n}',
				description: 'Corpo del PATCH /xapi/v1/Users(ID). L\'Id viene aggiunto automaticamente.',
				displayOptions: { show: { resource: ['user'], operation: ['update'] } },
			},

			// ------------------------------------------------------------------ group
			{
				displayName: 'Group ID',
				name: 'groupId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['group'], operation: ['get'] } },
			},
			{
				displayName: 'Include Members',
				name: 'includeMembers',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['group'], operation: ['get'] } },
			},

			// ------------------------------------------------------------------ get many
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: getAllResources, operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: getAllResources, operation: ['getAll'], returnAll: [false] } },
			},

			// ------------------------------------------------------------------ OData options
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: getAllResources, operation: ['get', 'getById', 'getAll'] } },
				options: [
					{
						displayName: 'Filter ($filter)',
						name: 'filter',
						type: 'string',
						default: '',
						placeholder: "startswith(Number,'1')",
						description: 'Filtro OData aggiuntivo (combinato in AND con gli altri)',
					},
					{
						displayName: 'Select ($select)',
						name: 'select',
						type: 'string',
						default: '',
						placeholder: 'Id,Number,FirstName,LastName',
					},
					{
						displayName: 'Expand ($expand)',
						name: 'expand',
						type: 'string',
						default: '',
						placeholder: 'Groups',
						description: 'Per i SIP device "DN" è sempre incluso',
					},
					{
						displayName: 'Order By ($orderby)',
						name: 'orderby',
						type: 'string',
						default: '',
						placeholder: 'Number',
					},
				],
			},

			// ------------------------------------------------------------------ custom
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				options: [
					{ name: 'GET', value: 'GET' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'PUT', value: 'PUT' },
					{ name: 'DELETE', value: 'DELETE' },
				],
				default: 'GET',
				displayOptions: { show: { resource: ['custom'] } },
			},
			{
				displayName: 'Endpoint',
				name: 'endpoint',
				type: 'string',
				required: true,
				default: '/xapi/v1/',
				placeholder: '/xapi/v1/Trunks',
				description: 'Percorso relativo al server. L\'elenco completo è in /xapi/v1/swagger.yaml del tuo centralino.',
				displayOptions: { show: { resource: ['custom'] } },
			},
			{
				displayName: 'Query Parameters (JSON)',
				name: 'queryParameters',
				type: 'json',
				default: '{}',
				placeholder: '{ "$top": 10, "$filter": "Number eq \'101\'" }',
				displayOptions: { show: { resource: ['custom'] } },
			},
			{
				displayName: 'Body (JSON)',
				name: 'body',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['custom'], method: ['POST', 'PATCH', 'PUT'] } },
			},
			{
				displayName: 'Split "value" Into Items',
				name: 'splitValue',
				type: 'boolean',
				default: true,
				description: 'Whether to output one item per element when the response is an OData collection ({ value: [...] })',
				displayOptions: { show: { resource: ['custom'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const results = await runOperation.call(this, resource, i);
				for (const json of results) {
					returnData.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

// ---------------------------------------------------------------------- operations

function buildQuery(options: IDataObject, baseFilters: string[] = [], forcedExpand: string[] = []): IDataObject {
	const qs: IDataObject = {};
	const filters = [...baseFilters];
	if (options.filter) filters.push(`(${String(options.filter)})`);
	if (filters.length) qs.$filter = filters.join(' and ');

	const expand = new Set(forcedExpand);
	String(options.expand ?? '')
		.split(',')
		.map((e) => e.trim())
		.filter(Boolean)
		.forEach((e) => expand.add(e));
	if (expand.size) qs.$expand = [...expand].join(',');

	if (options.select) qs.$select = String(options.select);
	if (options.orderby) qs.$orderby = String(options.orderby);
	return qs;
}

async function getLimit(this: IExecuteFunctions, i: number): Promise<number> {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	return returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
}

async function runOperation(this: IExecuteFunctions, resource: string, i: number): Promise<IDataObject[]> {
	if (resource === 'custom') return customRequest.call(this, i);

	const operation = this.getNodeParameter('operation', i) as string;

	// ---------------------------------------------------------------- SIP devices
	if (resource === 'sipDevice') {
		const vendor = (this.getNodeParameter('vendor', i, '') as string).trim();
		const parse = this.getNodeParameter('parseInterfaceLink', i, true) as boolean;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;

		const filters: string[] = [];
		if (vendor) filters.push(`Registrar/Vendor eq ${odataString(vendor)}`);

		let devices: IDataObject[];
		if (operation === 'get') {
			const number = String(this.getNodeParameter('extensionNumber', i)).trim();
			filters.unshift(`DN/Number eq ${odataString(number)}`);
			const qs = buildQuery({ orderby: 'DN/Number', ...options }, filters, ['DN']);
			const response = await xapiRequest.call(this, 'GET', '/xapi/v1/SipDevices', { ...qs, $top: 100 });
			const value: IDataObject[] = Array.isArray(response?.value) ? response.value : [];
			if (!value.length) {
				throw new Error(`Telefono non trovato per l'interno ${number}${vendor ? ` (vendor ${vendor})` : ''}`);
			}
			devices = [value[0]];
		} else {
			const qs = buildQuery({ orderby: 'DN/Number', ...options }, filters, ['DN']);
			devices = await xapiGetAll.call(this, '/xapi/v1/SipDevices', qs, await getLimit.call(this, i));
		}

		return parse ? devices.map((d) => ({ ...d, interface: parseInterfaceLink(d) })) : devices;
	}

	// ---------------------------------------------------------------- users
	if (resource === 'user') {
		if (operation === 'update') {
			const userId = this.getNodeParameter('userId', i) as number;
			const fields = toObject(this.getNodeParameter('updateFields', i), 'Fields to Update');
			await xapiRequest.call(this, 'PATCH', `/xapi/v1/Users(${userId})`, {}, { ...fields, Id: userId });
			return [{ success: true, id: userId }];
		}

		const options = this.getNodeParameter('options', i, {}) as IDataObject;

		if (operation === 'getById') {
			const userId = this.getNodeParameter('userId', i) as number;
			const qs = buildQuery({ ...options, filter: '' });
			return [await xapiRequest.call(this, 'GET', `/xapi/v1/Users(${userId})`, qs)];
		}

		if (operation === 'get') {
			const number = String(this.getNodeParameter('number', i)).trim();
			const qs = buildQuery(options, [`Number eq ${odataString(number)}`]);
			const response = await xapiRequest.call(this, 'GET', '/xapi/v1/Users', { ...qs, $top: 1 });
			const value: IDataObject[] = Array.isArray(response?.value) ? response.value : [];
			if (!value.length) throw new Error(`Interno ${number} non trovato`);
			return [value[0]];
		}

		const qs = buildQuery(options);
		return xapiGetAll.call(this, '/xapi/v1/Users', qs, await getLimit.call(this, i));
	}

	// ---------------------------------------------------------------- groups
	if (resource === 'group') {
		const options = this.getNodeParameter('options', i, {}) as IDataObject;

		if (operation === 'get') {
			const groupId = this.getNodeParameter('groupId', i) as number;
			const members = this.getNodeParameter('includeMembers', i, false) as boolean;
			const qs = buildQuery({ ...options, filter: '' }, [], members ? ['Members'] : []);
			return [await xapiRequest.call(this, 'GET', `/xapi/v1/Groups(${groupId})`, qs)];
		}

		const qs = buildQuery(options);
		return xapiGetAll.call(this, '/xapi/v1/Groups', qs, await getLimit.call(this, i));
	}

	// ---------------------------------------------------------------- system
	if (resource === 'system') {
		if (operation === 'getVersion') {
			const response = await xapiRequest.call(this, 'GET', '/xapi/v1/Defs', { $select: 'Id' }, undefined, true);
			const headers = (response?.headers ?? {}) as IDataObject;
			return [{ version: headers['x-3cx-version'] ?? null, authenticated: true }];
		}
		return [await xapiRequest.call(this, 'GET', '/xapi/v1/SystemStatus')];
	}

	throw new Error(`Risorsa non supportata: ${resource}`);
}

async function customRequest(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const method = this.getNodeParameter('method', i) as IHttpRequestMethods;
	const endpoint = this.getNodeParameter('endpoint', i) as string;
	const qs = toObject(this.getNodeParameter('queryParameters', i, '{}'), 'Query Parameters');
	const body = ['POST', 'PATCH', 'PUT'].includes(method)
		? toObject(this.getNodeParameter('body', i, '{}'), 'Body')
		: undefined;
	const splitValue = this.getNodeParameter('splitValue', i, true) as boolean;

	const response = await xapiRequest.call(this, method, endpoint, qs, body);

	if (response === undefined || response === null || response === '') {
		return [{ success: true }];
	}
	if (splitValue && Array.isArray(response?.value)) {
		return response.value as IDataObject[];
	}
	if (typeof response !== 'object') return [{ data: response }];
	return [response as IDataObject];
}
