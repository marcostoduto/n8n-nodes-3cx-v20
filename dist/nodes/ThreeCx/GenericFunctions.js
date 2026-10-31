"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDENTIAL_NAME = void 0;
exports.xapiRequest = xapiRequest;
exports.xapiGetAll = xapiGetAll;
exports.odataString = odataString;
exports.parseInterfaceLink = parseInterfaceLink;
exports.toObject = toObject;
exports.CREDENTIAL_NAME = 'threeCxV20Api';
const PAGE_SIZE = 100;
/** Esegue una chiamata XAPI con il token Bearer gestito dalla credenziale. */
async function xapiRequest(method, endpoint, qs = {}, body, returnFullResponse = false) {
    const credentials = await this.getCredentials(exports.CREDENTIAL_NAME);
    const baseUrl = String(credentials.serverUrl ?? '').replace(/\/+$/, '');
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const options = {
        method,
        url: `${baseUrl}${path}`,
        qs,
        json: true,
        skipSslCertificateValidation: credentials.allowUnauthorizedCerts === true,
        returnFullResponse,
    };
    if (body !== undefined && Object.keys(body).length) {
        options.body = body;
    }
    return await this.helpers.httpRequestWithAuthentication.call(this, exports.CREDENTIAL_NAME, options);
}
/** Legge una collezione OData paginando con $top/$skip. limit = 0 -> tutti. */
async function xapiGetAll(endpoint, qs = {}, limit = 0) {
    const results = [];
    let skip = 0;
    for (;;) {
        const top = limit ? Math.min(PAGE_SIZE, limit - results.length) : PAGE_SIZE;
        const response = await xapiRequest.call(this, 'GET', endpoint, { ...qs, $top: top, $skip: skip });
        const page = Array.isArray(response?.value) ? response.value : [];
        results.push(...page);
        skip += page.length;
        if (page.length < top || (limit && results.length >= limit))
            break;
    }
    return results;
}
/** Escape di una stringa per un filtro OData ('' al posto di '). */
function odataString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}
/**
 * Estrae ip/username/password da Registrar.InterfaceLink, come urlparse()
 * nel modulo Odoo (valori non decodificati).
 */
function parseInterfaceLink(device) {
    const registrar = device.Registrar;
    const link = registrar?.InterfaceLink;
    if (typeof link !== 'string' || !link)
        return null;
    try {
        const url = new URL(link);
        return {
            url: link,
            ip: url.hostname,
            port: url.port || null,
            username: url.username,
            password: url.password,
        };
    }
    catch {
        return { url: link, ip: null, username: null, password: null, error: 'InterfaceLink non valido' };
    }
}
/** Converte un parametro JSON (stringa o oggetto) in oggetto. */
function toObject(value, fieldName) {
    if (value === undefined || value === null || value === '')
        return {};
    if (typeof value === 'object')
        return value;
    try {
        return JSON.parse(String(value));
    }
    catch {
        throw new Error(`Il campo "${fieldName}" non contiene JSON valido`);
    }
}
