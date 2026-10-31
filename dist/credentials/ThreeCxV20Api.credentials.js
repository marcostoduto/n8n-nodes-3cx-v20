"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreeCxV20Api = void 0;
/**
 * Credenziale 3CX v20.
 *
 * Due modi per ottenere il token Bearer:
 *  - "password": login come il Web Client / Admin Console
 *      POST /webclient/api/Login/GetAccessToken  { Username, Password, SecurityCode: "" }
 *      -> { Status: "AuthSuccess", Token: { access_token, refresh_token, expires_in } }
 *  - "clientCredentials": API client creato in Admin Console > Integrations > API
 *      POST /connect/token  (form) client_id, client_secret, grant_type=client_credentials
 *      -> { access_token, expires_in }
 *
 * Il token è salvato nel campo nascosto "accessToken" (expirable): n8n lo riusa
 * e chiama di nuovo preAuthentication() quando una richiesta riceve 401.
 */
class ThreeCxV20Api {
    constructor() {
        this.name = 'threeCxV20Api';
        this.displayName = '3CX v20 API';
        this.documentationUrl = 'https://www.3cx.com/docs/configuration-rest-api/';
        this.icon = 'file:threecx.svg';
        this.properties = [
            {
                displayName: 'Server URL',
                name: 'serverUrl',
                type: 'string',
                default: '',
                placeholder: 'https://centralino.my3cx.it:5001',
                description: 'Indirizzo del centralino, con porta e senza slash finale',
                required: true,
            },
            {
                displayName: 'Authentication Method',
                name: 'authMethod',
                type: 'options',
                options: [
                    {
                        name: 'Username & Password (Web Client)',
                        value: 'password',
                        description: 'Login come utente 3CX (es. system owner). Funziona con qualsiasi licenza.',
                    },
                    {
                        name: 'API Client (Client Credentials)',
                        value: 'clientCredentials',
                        description: 'Client creato in Admin Console > Integrations > API (richiede licenza 8SC+)',
                    },
                ],
                default: 'password',
            },
            {
                displayName: 'Username',
                name: 'username',
                type: 'string',
                default: '',
                description: 'Interno o email dell\'utente 3CX',
                displayOptions: { show: { authMethod: ['password'] } },
            },
            {
                displayName: 'Password',
                name: 'password',
                type: 'string',
                typeOptions: { password: true },
                default: '',
                displayOptions: { show: { authMethod: ['password'] } },
            },
            {
                displayName: 'Client ID',
                name: 'clientId',
                type: 'string',
                default: '',
                displayOptions: { show: { authMethod: ['clientCredentials'] } },
            },
            {
                displayName: 'Client Secret (API Key)',
                name: 'clientSecret',
                type: 'string',
                typeOptions: { password: true },
                default: '',
                displayOptions: { show: { authMethod: ['clientCredentials'] } },
            },
            {
                displayName: 'Ignore SSL Issues',
                name: 'allowUnauthorizedCerts',
                type: 'boolean',
                default: false,
                description: 'Whether to connect even if the SSL certificate is not valid',
            },
            {
                displayName: 'Access Token',
                name: 'accessToken',
                type: 'hidden',
                typeOptions: { expirable: true },
                default: '',
            },
        ];
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    Authorization: '=Bearer {{$credentials.accessToken}}',
                },
            },
        };
        this.test = {
            request: {
                baseURL: '={{$credentials.serverUrl.replace(/\\/+$/, "")}}',
                url: '/xapi/v1/Defs',
                qs: { $select: 'Id' },
                skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
            },
        };
    }
    async preAuthentication(credentials) {
        const baseUrl = String(credentials.serverUrl ?? '').replace(/\/+$/, '');
        const skipSslCertificateValidation = credentials.allowUnauthorizedCerts === true;
        if (!baseUrl) {
            throw new Error('3CX: Server URL mancante nella credenziale');
        }
        if (credentials.authMethod === 'clientCredentials') {
            const body = new URLSearchParams({
                client_id: String(credentials.clientId ?? ''),
                client_secret: String(credentials.clientSecret ?? ''),
                grant_type: 'client_credentials',
            }).toString();
            const raw = await this.helpers.httpRequest({
                method: 'POST',
                url: `${baseUrl}/connect/token`,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
                skipSslCertificateValidation,
            });
            const res = (typeof raw === 'string' ? JSON.parse(raw) : raw);
            if (!res?.access_token) {
                throw new Error(`3CX: /connect/token non ha restituito un access_token: ${JSON.stringify(res)}`);
            }
            return { accessToken: String(res.access_token) };
        }
        // Login Web Client (come PhoneApi.login() in Odoo)
        const raw = await this.helpers.httpRequest({
            method: 'POST',
            url: `${baseUrl}/webclient/api/Login/GetAccessToken`,
            headers: { 'Content-Type': 'application/json' },
            body: {
                Username: String(credentials.username ?? ''),
                Password: String(credentials.password ?? ''),
                SecurityCode: '',
            },
            json: true,
            skipSslCertificateValidation,
        });
        const res = (typeof raw === 'string' ? JSON.parse(raw) : raw);
        const token = res?.Token;
        if (res?.Status !== 'AuthSuccess' || !token?.access_token) {
            throw new Error(`3CX: autenticazione fallita (Status: ${String(res?.Status ?? 'sconosciuto')}). ` +
                'Controlla utente/password; se l\'utente ha la 2FA attiva usa un API client.');
        }
        return { accessToken: String(token.access_token) };
    }
}
exports.ThreeCxV20Api = ThreeCxV20Api;
