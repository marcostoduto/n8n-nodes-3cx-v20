# n8n-nodes-3cx-v20

Nodo n8n per **3CX v20** che usa la stessa autenticazione del modulo Odoo
(`PhoneApi.login()`): login con utente e password su
`/webclient/api/Login/GetAccessToken` e poi chiamate alla Configuration API
(`/xapi/v1/...`) con token Bearer.

Il token viene gestito da n8n: si ottiene al primo utilizzo, si riusa e si
rinnova da solo quando il 3CX risponde 401 (token scaduto).

## Credenziale "3CX v20 API"

| Campo | Note |
|---|---|
| Server URL | es. `https://camerana.my3cx.it:5001` |
| Authentication Method | **Username & Password (Web Client)**: come in Odoo, funziona con qualsiasi licenza. **API Client**: client creato in *Admin Console > Integrations > API* (`/connect/token`, licenza 8SC+). |
| Username / Password | utente 3CX con permessi adeguati (es. system owner). Senza 2FA. |
| Ignore SSL Issues | solo se il certificato non è valido |

Il pulsante **Test** della credenziale chiama `GET /xapi/v1/Defs?$select=Id`.

## Operazioni

| Risorsa | Operazione | Chiamata |
|---|---|---|
| SIP Device | Get by Extension | `GET /xapi/v1/SipDevices?$filter=DN/Number eq '101' [and Registrar/Vendor eq 'Fanvil']&$expand=DN`: primo risultato, come `getphone()` |
| SIP Device | Get Many | stessa collezione, con paginazione `$top`/`$skip` |
| User | Get by Number / Get by ID / Get Many | `/xapi/v1/Users` |
| User | Update | `PATCH /xapi/v1/Users(ID)` (l'`Id` viene aggiunto al corpo) |
| Group | Get / Get Many | `/xapi/v1/Groups` (opzione `$expand=Members`) |
| System | Get Status | `GET /xapi/v1/SystemStatus` |
| System | Get Version | header `X-3CX-Version` di `/xapi/v1/Defs` |
| Custom XAPI Request | qualsiasi | metodo, percorso, query e body liberi |

Per i SIP device l'opzione **Parse Interface Link** (attiva di default) aggiunge:

```json
"interface": { "url": "http://admin:pw@10.10.4.20", "ip": "10.10.4.20", "port": null, "username": "admin", "password": "pw" }
```

con gli stessi valori che il modulo Odoo salva in `ip`, `username`, `password`, `url_access`.

L'elenco completo degli endpoint del tuo centralino è in
`https://<server>/xapi/v1/swagger.yaml`: tutto quello che non ha
un'operazione dedicata si chiama con **Custom XAPI Request**.

## Installazione in n8n (Docker)

La cartella `dist/` è già compilata nel repository: per usarla non serve fare la build.

1. Copia il repository sul server, ad esempio in `./n8n/custom-nodes/n8n-nodes-3cx-v20`.
2. Nel `docker-compose` aggiungi al servizio `n8n`:

   ```yaml
   services:
     n8n:
       volumes:
         - ./n8n/custom-nodes:/home/node/custom-nodes
       environment:
         - N8N_CUSTOM_EXTENSIONS=/home/node/custom-nodes
   ```

3. Riavvia n8n: `docker compose up -d n8n`
4. Nel editor cerca **3CX v20** tra i nodi e crea la credenziale **3CX v20 API**.

Il nodo non esegue codice nei task runner, quindi non serve toccare `n8n-runners`.

### In alternativa, con un pacchetto npm

```bash
npm pack          # crea mstoduto-n8n-nodes-3cx-v20-1.0.2.tgz
```

e installalo dentro `~/.n8n/nodes` del container n8n (`npm install /percorso/mstoduto-n8n-nodes-3cx-v20-1.0.2.tgz`).

## Sviluppo

```bash
npm install       # installa typescript e i tipi di n8n-workflow
npm run build     # compila in dist/ e copia le icone
npm test          # build + test contro un finto server 3CX (test/mock-test.js)
```

Il codice compilato non richiede `n8n-workflow` a runtime: da quella libreria
usa solo i tipi TypeScript.

## Pubblicazione su npm

**Automatica (GitHub Actions):**

1. Su npmjs.com crea un token di tipo *Granular Access Token* con permesso di pubblicazione.
2. Su GitHub aggiungilo come secret `NPM_TOKEN` (*Settings > Secrets and variables > Actions*).
3. Aggiorna `version` in `package.json`, fai commit e crea il tag corrispondente:

   ```bash
   git tag v1.0.2 && git push origin v1.0.2
   ```

Il workflow `.github/workflows/publish.yml` esegue i test e pubblica il pacchetto con provenance.

**Manuale:**

```bash
npm login
npm publish --access public
```

Dopo la pubblicazione il nodo si installa da n8n in *Settings > Community Nodes > Install*
con il nome `@mstoduto/n8n-nodes-3cx-v20`.

## Licenza

MIT
