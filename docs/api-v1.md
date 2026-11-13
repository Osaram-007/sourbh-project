# FullCharge API v1 contract

Base path: `/api/v1`. This document is the source of truth for the v1 routes. The web app, the future mobile app and the contract test (T1-33) all build against it. Changes inside v1 are additive only; a breaking change goes to `/api/v2`.

Items marked **Provisional** are not final: the decision records leave them open, or a founder confirmation is pending. Clients must not hard-code them, and they may change before v1 is frozen. Everything else is the contract.

All example values are fake (`example.test`, `Sample Station A`, made-up ids and coordinates).

## 1. Conventions

### 1.1 Auth modes

Every route declares exactly one mode.

| Mode | Meaning |
|---|---|
| `none` (anonymous) | No credential is read. Public reads ignore any cookie or token that is sent. |
| `user` | A signed-in user. |
| `admin` | A signed-in user who is currently an administrator. Admin routes live under `/api/admin/*` and `/api/analytics/*`, not under `/api/v1`. They are outside this contract except where noted. |

Credentials for `user`:

- **Session cookie.** An opaque, server-side session in an httpOnly cookie, created by `POST /session`. The cookie is `__Host-fc_session` (Secure) in deployed environments and `fc_session` on local http. The cookie value is random and never appears in a response body.
- **Bearer token.** `Authorization: Bearer <ID token>` where the token is a Firebase ID token. Intended for the future mobile app. A request with a Bearer header does not use the cookie.

Both credentials resolve to the same user context, so no endpoint behaves differently by credential, except for the CSRF rule below.

Whether a user is an administrator is computed on the server on each request. It is never taken from a request field or a token claim. The only place a client learns it is the `isAdmin` flag on `GET /me`.

### 1.2 CSRF rule

Applies to every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) authenticated by cookie, and also to `POST /session` itself.

- If `Sec-Fetch-Site` is present, it must be `same-origin`.
- Otherwise the `Origin` header must equal the configured app origin.
- A failure returns 403 `forbidden`.
- Bearer-authenticated requests are exempt, because they carry no ambient credential.

`POST /enquiries` has its own Origin check (section 3.18).

### 1.3 Errors

Standard error body:

```json
{ "error": { "code": "not_found", "message": "Station not found.", "details": {} } }
```

`details` is optional. `message` is a fixed, human-readable string; it never contains internal detail, stack traces or personal data.

| Code | HTTP | Notes |
|---|---|---|
| `validation_failed` | 400 | Bad query string or path parameter. |
| `validation_failed` | 422 | Bad JSON body. `details.fields` maps a field name to a message. |
| `not_available` | 400 | A sort or filter that exists in the schema but is not offered yet. |
| `auth_missing`, `auth_invalid`, `auth_expired`, `auth_revoked`, `account_deleted` | 401 | |
| `forbidden` | 403 | Includes a failed CSRF check. |
| `not_found` | 404 | |
| `station_gone` | 404 | The station no longer exists. `details.mergedInto` holds the replacement id when it was merged. |
| `conflict`, `account_conflict` | 409 | `account_conflict` is returned only by `POST /session`. |
| `payload_too_large` | 413 | **Provisional.** See open question Q5. |
| `rate_limited` | 429 | Carries a `Retry-After` header in seconds. |
| `internal` | 500 | |

Exception: `POST /enquiries` returns its own 400 body (section 3.18) instead of the standard envelope for field errors.

### 1.4 Request bodies

- JSON only, `Content-Type: application/json`.
- Maximum body size is 16 KB.
- Every string has a length cap. Every enum is closed. Unknown body fields are ignored. Unknown query parameters are ignored.

### 1.5 Pagination

List endpoints return:

```json
{ "items": [], "total": 0, "excludedUnknown": 0, "nextCursor": null, "hasMore": false }
```

- `limit` defaults to 20 and is at most 50.
- `cursor` is an opaque base64url string. A cursor is only valid with the same filters and sort that produced it.
- `total` is the number of items matching the filters across all pages. It is not the length of `items`.
- `excludedUnknown` appears only on station lists and markers (section 1.6). Lists that are not filterable (for example `me/vehicles`) return `items`, `nextCursor`, `hasMore` and `total`, without `excludedUnknown`.

### 1.6 `excludedUnknown`

When a filter is active, a station whose value for that filter is unknown is not returned. `excludedUnknown` says how many stations were left out for that reason. It is the number of stations that would match if every unknown value were treated as a match, minus the number that match strictly. It covers every active filter that can be unknown: connector type, current, power, availability, price and amenities. With no active filter it is 0.

### 1.7 Rate limits

Counters are per process and reset on restart.

| Bucket | Default |
|---|---|
| Per client IP, every request | 120 per minute |
| Per user, authenticated requests | 120 per minute |
| Per user, writes | 20 per minute |
| `POST /session`, per IP | 10 per minute |
| `POST /enquiries`, per IP | 5 per hour |

The defaults of the first three are configurable by the operator. Over the limit, the response is 429 with `Retry-After` and a `rate_limited` body.

### 1.8 Latency budgets and payload caps

Server time at roughly 20,000 stations. Payloads are uncompressed JSON; the edge proxy compresses.

| Endpoint | p95 | Payload cap |
|---|---|---|
| `GET /stations` | 300 ms on a cache miss, 50 ms on a hit | 40 KB (a page of 20) |
| `GET /stations/markers` | 300 ms miss, 50 ms hit | 60 KB (500 markers) |
| `GET /stations/{id}` | 150 ms | 20 KB |
| `GET /search` | 300 ms | not set |

Other endpoints have no stated budget. An unavailable or failing data feed never fails a read endpoint: reads are served from stored data only.

### 1.9 Caching

- Public reads (auth mode `none`, GET) send `Cache-Control: public, max-age=30`. This is a browser cache only.
- Public reads are the same for every caller and contain no per-user fields. Saved-station state comes from `GET /me/shortlist`.
- `me`, `me/*`, `session` and `POST` responses send `Cache-Control: no-store`.
- Server-side, station reads use a cache that is bypassed gracefully if unavailable.
- Bounding-box requests are rounded outward to a 0.01 degree grid, and the query uses the rounded box. A response can therefore include stations slightly outside the requested box.
- Request coordinates and search text are never stored or logged.

### 1.10 Formats

- Times are ISO 8601 UTC strings (`2030-01-01T10:00:00Z`).
- `distanceKm` is rounded to 0.1.
- Money is INR per kWh, as a number, and is present only when the unit is known.
- Ids are opaque strings. Do not parse them.

### 1.11 Versioning

Within v1 the API changes additively: new endpoints, new optional parameters, new response fields. Clients must ignore unknown response fields. Removing or renaming a field, or changing a type or meaning, requires `/api/v2`.

## 2. Shared types

### 2.1 Availability

```ts
type AvailabilityState = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN";
type Confidence = "LIVE" | "RECENT" | "UNKNOWN";

interface Availability {
  state: AvailabilityState;
  confidence: Confidence;
  connectorsFree?: number;   // present only when confidence is LIVE
  connectorsTotal?: number;  // present only when confidence is LIVE
}
```

- The four states are the only station-level states. There is no station-level "in use" and no "maintenance" state.
- The state is computed on the server from configured thresholds. When confidence is `UNKNOWN`, the state is `UNKNOWN`.
- A live source reporting a station offline yields `UNAVAILABLE`.
- Clients must show a state as colour, icon and text together. The web app takes all three from one shared map; this API only supplies the state key.

### 2.2 Freshness

Every station and every connector carries:

| Field | Type | Meaning |
|---|---|---|
| `lastSourceUpdate` | string or null | Time reported by the data source, or null if it reports none. |
| `lastFullchargeUpdate` | string | When FullCharge last successfully observed the record. |

The stored internal "last updated" column is never exposed.

### 2.3 Connector status (per connector)

`ConnectorSourceStatus`: `AVAILABLE`, `OCCUPIED`, `FAULTED`, `UNKNOWN`. **Provisional** (WDEC-6/7: enum values are not final).

A per-connector status is meaningful only when that connector's `confidence` is `LIVE` or `RECENT`. At any other confidence, treat it as `UNKNOWN`. Clients map these to display words; raw enum names are not for display.

### 2.4 Connector types

`ConnectorType` (**Provisional**, WDEC-6/7): `CCS2`, `CHADEMO`, `TYPE2`, `TYPE1`, `GB_T`, `BHARAT_AC`, `BHARAT_DC`, `WALL_SOCKET`.

- Station connectors may also carry `UNKNOWN` as a type when the source did not say. `UNKNOWN` never matches any filter and never appears in a vehicle model or in a user's manual vehicle list. Whether `UNKNOWN` is a member of the same enum or is expressed as a null `type` is **Provisional** (open question Q3).
- `CurrentType` (**Provisional**): `AC`, `DC`.

**Compatibility rule (WDEC-14).** A vehicle's supported set is its model's AC and DC connector types, or the user's manual list. A station is compatible if at least one connector has a type in that set. Clients send the set through the ordinary `connectorTypes` filter. Two points:

1. The server resolves `TYPE2` in the filter as also matching connectors recorded as `CCS2` only. This happens in the query. Stored connector data is never altered, so a station's returned `type` is exactly what its source stated.
2. The reverse does not apply: a `CCS2` filter does not match `TYPE2`.

Power is never compared. The server does not receive the user's vehicle, so station responses stay shareable between users.

### 2.5 Station summary

Returned in station lists. **Provisional** as to exact field set: the field list below is the intended minimum; ADR-0008 fixes only the availability, freshness and distance fields.

```ts
interface StationSummary {
  id: string;
  name: string;
  network: string | null;        // normalised network name
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  distanceKm?: number;           // only when a centre point was given
  availability: Availability;
  connectors: ConnectorSummary[];
  maxPowerKw: number | null;
  minPriceInrPerKwh: number | null;
  lastSourceUpdate: string | null;
  lastFullchargeUpdate: string;
}

interface ConnectorSummary {
  type: ConnectorType;
  current: "AC" | "DC" | null;
  powerKw: number | null;
  count: number;                 // connectors of this type and power at the station
}
```

### 2.6 Station detail

Extends `StationSummary`. Fields are **Provisional** beyond those below.

```ts
interface StationDetail extends Omit<StationSummary, "connectors"> {
  connectors: Connector[];
  amenities: string[];           // empty array means none listed
  hours: string | null;
  contact?: { phone?: string; url?: string };   // only when the source permits
  sourceName?: string;                          // only when branding is permitted
  disclaimerKeys: string[];                     // keys the client maps to wording
}

interface Connector {
  id: string;
  type: ConnectorType;
  current: "AC" | "DC" | null;
  powerKw: number | null;
  priceInrPerKwh: number | null;
  status: ConnectorSourceStatus;
  confidence: Confidence;
  lastSourceUpdate: string | null;
  lastFullchargeUpdate: string;
}
```

### 2.7 Marker

```ts
interface Marker {
  id: string;
  latitude: number;
  longitude: number;
  state: AvailabilityState;
}
```

### 2.8 Pagination envelope

See 1.5.

## 3. Endpoints

Unless stated, errors include 429 (any endpoint) and 500.

### 3.1 `GET /stations`

Auth: `none`. Rate limit: IP bucket.

Returns servable stations, ordered by distance then id when a centre point is given.

Query. All names and values in this table are **Provisional** except `connectorTypes`, `limit` and `cursor` (ADR-0019 and ADR-0008):

| Param | Type | Notes |
|---|---|---|
| `lat`, `lng` | number | Centre point. Both or neither. |
| `radiusKm` | number | 0 to 100, default 100. Ignored if a bounding box is given. |
| `bbox` | `west,south,east,north` | Alternative to centre and radius. Rounded outward to 0.01 degrees. |
| `connectorTypes` | comma list of `ConnectorType` | See 2.4 for the TYPE2/CCS2 rule. |
| `current` | `AC` or `DC` | |
| `minPowerKw`, `maxPowerKw` | number | |
| `availability` | comma list of `AvailabilityState` | |
| `networks` | comma list of network names | Values come from `GET /networks`. |
| `maxPriceInrPerKwh` | number | Stations with unknown price are excluded and counted in `excludedUnknown`. |
| `amenities` | comma list | |
| `sort` | `distance`, `price`, `power`, `availability` | Default `distance` when a centre point is given. Unknown values last. Rating and reliability sorts return 400 `not_available`. |
| `limit`, `cursor` | | See 1.5. |

All connector-level filters (`connectorTypes`, `current`, power) must hold on the same connector.

Response 200: `{ items: StationSummary[], total, excludedUnknown, nextCursor, hasMore }`.

Errors: 400 `validation_failed` (bad parameter, a centre point without both coordinates, an inverted box), 400 `not_available`.

Example:

```
GET /api/v1/stations?lat=10.000&lng=20.000&radiusKm=5&connectorTypes=CCS2,TYPE2&limit=1
```

```json
{
  "items": [{
    "id": "stn_example1",
    "name": "Sample Station A",
    "network": "Sample Network",
    "address": "1 Example Road",
    "city": "Exampleville",
    "state": "Example State",
    "latitude": 10.001,
    "longitude": 20.001,
    "distanceKm": 0.2,
    "availability": { "state": "AVAILABLE", "confidence": "LIVE", "connectorsFree": 2, "connectorsTotal": 4 },
    "connectors": [{ "type": "CCS2", "current": "DC", "powerKw": 30, "count": 2 }],
    "maxPowerKw": 30,
    "minPriceInrPerKwh": null,
    "lastSourceUpdate": "2030-01-01T10:00:00Z",
    "lastFullchargeUpdate": "2030-01-01T10:01:00Z"
  }],
  "total": 12,
  "excludedUnknown": 1,
  "nextCursor": "eyJvIjoxfQ",
  "hasMore": true
}
```

### 3.2 `GET /stations/markers`

Auth: `none`. Rate limit: IP bucket.

Requires `bbox`. Accepts the same filters as 3.1. Returns at most 500 stations, the ones nearest the box centre. It is never silently cut.

Response 200: `{ items: Marker[], total, truncated, excludedUnknown }`. `total` is the full match count; `truncated` is true when `total` exceeds the items returned. No cursor.

Errors: 400 `validation_failed` (missing or invalid `bbox`).

Example response:

```json
{ "items": [{ "id": "stn_example1", "latitude": 10.001, "longitude": 20.001, "state": "LIMITED" }],
  "total": 1, "truncated": false, "excludedUnknown": 0 }
```

### 3.3 `GET /stations/{id}`

Auth: `none`. Rate limit: IP bucket. Budget 150 ms.

Response 200: `StationDetail`.

Errors: 404 `not_found`; 404 `station_gone` with `details.mergedInto` (a station id) if the station was merged into another.

Example response (abridged):

```json
{ "id": "stn_example1", "name": "Sample Station A", "availability": { "state": "UNKNOWN", "confidence": "UNKNOWN" },
  "connectors": [{ "id": "con_example1", "type": "TYPE2", "current": "AC", "powerKw": 7.4, "priceInrPerKwh": null,
    "status": "UNKNOWN", "confidence": "UNKNOWN", "lastSourceUpdate": null, "lastFullchargeUpdate": "2030-01-01T10:01:00Z" }],
  "amenities": [], "hours": null, "disclaimerKeys": ["availability"] }
```

### 3.4 `GET /search`

Auth: `none`. Rate limit: IP bucket. Budget 300 ms.

Query: `q` (string, 2 to 100 characters after trimming; required).

Response 200:

```ts
{
  stations: { id: string; name: string; city: string | null; network: string | null }[];
  places:   { name: string; state: string | null; latitude: number; longitude: number }[];
  networks: string[];
  suggestions: string[];   // closest terms; filled when the groups are empty
}
```

Each group is capped (cap is **Provisional**; intended 10 stations, 5 places, 5 networks). Typo tolerance is best effort and may be prefix matching only at launch.

Errors: 400 `validation_failed` (`q` missing or under 2 characters).

Example: `GET /api/v1/search?q=sample` returns `{"stations":[{"id":"stn_example1","name":"Sample Station A","city":"Exampleville","network":"Sample Network"}],"places":[],"networks":["Sample Network"],"suggestions":[]}`.

### 3.5 `GET /networks`

Auth: `none`. Rate limit: IP bucket.

Distinct, normalised network names among servable stations. Feeds the filter list.

Response 200: `{ items: string[] }` (not paginated).

Example: `{"items":["Sample Network","Other Sample Network"]}`.

### 3.6 `GET /config`

Auth: `none`. Rate limit: IP bucket.

Public runtime settings. Shape is **Provisional** (T1-16); intended contents:

```ts
{
  availability: { liveMaxAgeMin: number; recentMaxAgeMin: number };  // thresholds in effect
  flags: Record<string, boolean>;
  legal: { privacyVersion: string; termsVersion: string };           // current versions
  helpline: string | null;
  minAppVersion: string | null;
}
```

Example: `{"availability":{"liveMaxAgeMin":15,"recentMaxAgeMin":60},"flags":{},"legal":{"privacyVersion":"2030-01","termsVersion":"2030-01"},"helpline":null,"minAppVersion":null}`.

### 3.7 `GET /health`

Auth: `none`. Rate limit: IP bucket. No auth step, no stated budget.

Response 200: `{ status: "ok", db: "ok", version: string }`. If the database check fails, 503 with `{ status: "degraded", db: "down", version }`. This endpoint is the one place a 503 occurs. It leaks no host or connection detail.

### 3.8 `POST /session`

Auth: `none` (the Firebase ID token in the body is the credential). Rate limit: 10 per minute per IP. CSRF rule applies. `Cache-Control: no-store`.

Request: `{ "idToken": string }`. The token must be recent: sign-in within the last 5 minutes.

Response 200: `{ displayName: string | null, isAdmin: boolean }`, and sets the session cookie. No token is ever in the body.

- Session lifetime is absolute (no sliding): 14 days for a user, 8 hours when the account is administrator-eligible. Cookie `Max-Age` matches.

Errors: 401 `auth_invalid`, `auth_expired` (token, or token too old); 403 `forbidden` (CSRF); 409 `account_conflict` (the identity cannot be bound to the existing account); 422 `validation_failed`.

Example: `POST /api/v1/session` body `{"idToken":"example-token"}` returns `{"displayName":"Sample User","isAdmin":false}` with a `Set-Cookie` header.

### 3.9 `DELETE /session`

Auth: `user`. CSRF rule applies. Deletes the server session and clears the cookie (and the non-sensitive "signed in" hint cookie).

Response 204, no body. Idempotent for a valid session. Errors: 401, 403.

A Bearer caller has no session to delete; the call returns 204 and does nothing.

### 3.10 `/me`

Auth: `user`. `no-store`. Write rate limit applies to mutations.

**`GET /me`** returns:

```ts
{
  id: string;
  displayName: string | null;
  email: string | null;       // only if verified
  phone: string | null;
  isAdmin: boolean;
  onboardingCompletedAt: string | null;
}
```

**`PATCH /me`** body `{ displayName: string }` (1 to 60 characters, trimmed; cap **Provisional**). Returns the same shape as `GET /me`. Errors: 422.

**`DELETE /me`** erases the account: personal data is anonymised, vehicles and shortlist are removed, and existing sessions stop working. Response 204. Scope of retained data is **Provisional** (open question Q8). Errors: 401, 403.

Example: `GET /api/v1/me` returns `{"id":"usr_example1","displayName":"Sample User","email":null,"phone":null,"isAdmin":false,"onboardingCompletedAt":null}`.

### 3.11 `/me/vehicles`

Auth: `user`. `no-store`.

```ts
interface Vehicle {
  id: string;
  vehicleModelId: string | null;     // an active catalogue model
  connectorTypes: ConnectorType[];   // the manual set; empty when a model is used
  nickname: string | null;           // up to 40 characters (cap Provisional)
  model?: { make: string; model: string; variant: string | null };  // present when vehicleModelId is set
  createdAt: string;
}
```

- **`GET /me/vehicles`**: `{ items: Vehicle[], total, nextCursor, hasMore }`.
- **`POST /me/vehicles`**: body `{ vehicleModelId?: string, connectorTypes?: ConnectorType[], nickname?: string }`. Exactly one of `vehicleModelId` or a non-empty `connectorTypes` is required. The model must be active. `connectorTypes` must not contain `UNKNOWN`. Returns 201 with the `Vehicle`.
- **`PATCH /me/vehicles/{id}`**: any subset of the same fields. Changing from a model to a manual list (or back) must leave the vehicle valid. Returns the `Vehicle`.
- **`DELETE /me/vehicles/{id}`**: 204. The last vehicle may be deleted.

A user may only reach their own vehicles; another user's id returns 404. No registration number is stored. The maximum vehicles per user is **Provisional** (open question Q9).

Errors: 401, 403, 404 `not_found`, 422 `validation_failed` (for example an inactive model).

Example: `POST /api/v1/me/vehicles` body `{"connectorTypes":["TYPE2"],"nickname":"Sample car"}` returns 201 `{"id":"veh_example1","vehicleModelId":null,"connectorTypes":["TYPE2"],"nickname":"Sample car","createdAt":"2030-01-01T10:00:00Z"}`.

### 3.12 `/me/consents`

Auth: `user`. `no-store`. Records are append-only: accepting and withdrawing each add a record; none is edited or deleted.

```ts
interface ConsentRecord {
  kind: "PRIVACY" | "TERMS";   // Provisional: the set of kinds
  version: string;
  action: "ACCEPT" | "WITHDRAW";
  at: string;
}
```

- **`GET /me/consents`**: `{ current: { kind, version, acceptedAt }[], required: { kind, version }[], history: ConsentRecord[] }`. `current` lists the latest accepted version per kind (not withdrawn). `required` lists versions from `GET /config` that the user has not accepted. Exact shape is **Provisional** (open question Q7).
- **`POST /me/consents`**: body `{ kind, version, action }`. Returns 201 with the new `ConsentRecord`. Accepting needs the current version from config; any other version returns 422.

Onboarding is complete once the current versions are accepted.

Example: `POST /api/v1/me/consents` body `{"kind":"PRIVACY","version":"2030-01","action":"ACCEPT"}` returns 201 `{"kind":"PRIVACY","version":"2030-01","action":"ACCEPT","at":"2030-01-01T10:00:00Z"}`.

### 3.13 `/me/shortlist`

Auth: `user`. `no-store`.

- **`GET /me/shortlist`**: `{ groups: { state: AvailabilityState; items: ShortlistItem[] }[], gone: ShortlistItem[] }` (**Provisional**: two reasonable shapes, see Q6). `ShortlistItem` is a `StationSummary` without `distanceKm`, plus `savedAt: string`. A station that has been removed from the listing appears under `gone` with only `id`, `name` and `savedAt`.
- **`PUT /me/shortlist/{stationId}`**: saves the station. Idempotent. Response 204. 404 `not_found` if the station is unknown.
- **`DELETE /me/shortlist/{stationId}`**: removes it. Idempotent, 204 even if it was not saved.

Public station responses never carry saved state.

Example: `PUT /api/v1/me/shortlist/stn_example1` returns 204.

### 3.14 `/me/reviews`

Auth: `user`. Reviews are visible as soon as they are submitted; an administrator can hide one afterwards. One review per user per station.

```ts
interface Review {
  id: string;
  stationId: string;
  rating: number;        // integer 1 to 5
  comment: string | null; // plain text, up to 500 characters
  createdAt: string;
  updatedAt: string;
}
```

- **`GET /me/reviews`** (**Provisional**: listing the user's own reviews is not in the decision records; see Q10): `{ items: Review[], total, nextCursor, hasMore }`.
- **`PUT /me/reviews/{stationId}`**: creates or replaces the user's review. Body `{ rating: number, comment?: string }`. Returns 200 with the `Review`. 404 if the station is unknown or not servable. 422 on bad rating or comment.
- **`DELETE /me/reviews/{stationId}`**: 204, idempotent.

Comments are stored and returned as plain text. Clients must render them as text, never as markup.

Example: `PUT /api/v1/me/reviews/stn_example1` body `{"rating":4,"comment":"Sample comment"}` returns `{"id":"rev_example1","stationId":"stn_example1","rating":4,"comment":"Sample comment","createdAt":"2030-01-01T10:00:00Z","updatedAt":"2030-01-01T10:00:00Z"}`.

### 3.15 `GET /stations/{id}/reviews`

Auth: `none`. Rate limit: IP bucket.

Returns visible (not hidden) reviews for the station, newest first. Query: `limit`, `cursor`.

```ts
{
  items: { id: string; authorName: string; rating: number; comment: string | null; createdAt: string }[];
  total: number;
  summary: { count: number; average: number | null };  // average is null below 5 reviews
  nextCursor: string | null;
  hasMore: boolean;
}
```

`authorName` is the first name and last initial only. The list is described to users as unverified reviews. Errors: 404 `not_found`, `station_gone`.

Example: `{"items":[{"id":"rev_example1","authorName":"Sample U.","rating":4,"comment":"Sample comment","createdAt":"2030-01-01T10:00:00Z"}],"total":1,"summary":{"count":1,"average":null},"nextCursor":null,"hasMore":false}`.

### 3.16 `POST /reviews/{id}/report`

Auth: `user`. CSRF rule applies. Write rate limit applies.

Body: `{ reason: ReportReason, note?: string }`. `ReportReason` is **Provisional** (open question Q11); intended `SPAM`, `ABUSIVE`, `IRRELEVANT`, `OTHER`. `note` is plain text, up to 300 characters (cap Provisional).

Response 204. A user can report a given review once; a repeat returns 409 `conflict`. Errors: 401, 403, 404 `not_found` (unknown or hidden review), 422.

Example: `POST /api/v1/reviews/rev_example1/report` body `{"reason":"SPAM"}` returns 204.

### 3.17 `GET /vehicle-models`

Auth: `none`. Rate limit: IP bucket. Public and cacheable.

Returns the active catalogue.

```ts
{
  items: {
    id: string;
    make: string;
    model: string;
    variant: string | null;
    acConnectorTypes: ConnectorType[];
    dcConnectorTypes: ConnectorType[];
    maxAcKw: number | null;
    maxDcKw: number | null;
    batteryKwh: number | null;
  }[];
}
```

Not paginated (the catalogue is small; if it outgrows that, pagination is added additively). Connector arrays never contain `UNKNOWN`. The source citation and verification date are stored but are not part of this response (**Provisional**, open question Q12).

A client builds a vehicle's filter by taking the union of the two connector arrays and sending it as `connectorTypes` (see 2.4). The catalogue lists only what a source states, so the UI should say a station "has a connector your vehicle supports", never that it charges at full speed.

Example: `{"items":[{"id":"vm_example1","make":"Sample Make","model":"Sample Model","variant":null,"acConnectorTypes":["TYPE2"],"dcConnectorTypes":["CCS2"],"maxAcKw":7.4,"maxDcKw":50,"batteryKwh":30}]}`.

### 3.18 `POST /enquiries`

Auth: `none`. Rate limit: 5 per hour per IP. `no-store`. This route matches the shipped request contract in `src/lib/enquiries.ts`.

**Origin check.** The `Origin` header must match the configured app origin. A failure returns 403 `forbidden` (standard error body). (Whether a missing `Origin` is also rejected is open question Q13.)

**Request** (JSON, 16 KB cap):

```ts
interface EnquiryRequest {
  name: string;          // required, at most 100 characters
  email: string;         // required, valid address, at most 254 characters
  organisation: string;  // optional; send "" when blank; at most 150 characters
  type: "BUSINESS" | "OPERATOR" | "OTHER";   // Provisional, pending founder confirmation
  message: string;       // optional; send "" when blank; at most 2000 characters
  consent: true;         // must be literally true
  website: string;       // honeypot: always "" from a real user
}
```

`type` is **Provisional** pending founder confirmation of the options; the server stores it as a plain string until then, so the value set may change.

**Honeypot.** If `website` is non-empty, the server returns the same 2xx response as a real success and stores nothing. A client cannot tell the difference.

**Responses.**

- 201 `{ "ok": true }` on success and on a honeypot hit. (The exact 2xx code and body are **Provisional**, open question Q14; the requirement is only that success and honeypot are identical.)
- 400 `EnquiryErrorBody`:

  ```ts
  interface EnquiryErrorBody {
    fields?: Partial<Record<"name" | "email" | "message" | "consent", string>>;
  }
  ```

  `fields` is keyed by form field, with one message per field. There is no `organisation` or `type` key; a failure on either returns 400 with no `fields` entry (or no `fields` at all), and the form shows its generic error. This body is not the standard error envelope.
- 403 `forbidden`: Origin check failed.
- 413 or 400 for a body over 16 KB (see Q5).
- 429 `rate_limited`: more than 5 per hour from one IP, with `Retry-After`.

No IP address is stored. No email notification is sent in v1.

Example: `POST /api/v1/enquiries`

```json
{ "name": "Sample Person", "email": "person@example.test", "organisation": "", "type": "OTHER",
  "message": "", "consent": true, "website": "" }
```

Response: `201 {"ok":true}`.

## 4. Route and auth summary

| Route | Methods | Auth |
|---|---|---|
| `/health`, `/config` | GET | none |
| `/stations`, `/stations/markers`, `/stations/{id}`, `/stations/{id}/reviews` | GET | none |
| `/search`, `/networks`, `/vehicle-models` | GET | none |
| `/session` | POST | none (ID token in body) |
| `/session` | DELETE | user |
| `/enquiries` | POST | none |
| `/me` | GET, PATCH, DELETE | user |
| `/me/vehicles`, `/me/vehicles/{id}` | GET, POST, PATCH, DELETE | user |
| `/me/consents` | GET, POST | user |
| `/me/shortlist`, `/me/shortlist/{stationId}` | GET, PUT, DELETE | user |
| `/me/reviews`, `/me/reviews/{stationId}` | GET, PUT, DELETE | user |
| `/reviews/{id}/report` | POST | user |

## 5. Open questions

Each is recorded rather than decided. Q6 and Q3 have two reasonable shapes with downstream effects.

- **Q1.** Pagination plus `total` on sorts that put unknown values last: whether `total` counts all matches or only the ones with a known sort key. Not decided.
- **Q2.** Filter parameter encoding (comma lists as in this document, or repeated parameters). Comma lists assumed; **Provisional**.
- **Q3.** Whether `UNKNOWN` is an enum member of `ConnectorType` or a null `type` (the current data model has no `UNKNOWN` member).
- **Q4.** Station summary and detail field set beyond availability, freshness and distance.
- **Q5.** Behaviour for a body over 16 KB: `413 payload_too_large` or 400/422.
- **Q6.** Shortlist grouping: server-grouped by state, or a flat list the client groups.
- **Q7.** Consent record kinds and the `GET /me/consents` shape.
- **Q8.** Which data `DELETE /me` retains, if any.
- **Q9.** Maximum vehicles per user.
- **Q10.** Whether `GET /me/reviews` exists.
- **Q11.** Review report reasons.
- **Q12.** Whether `sourceUrl` and `verifiedAt` appear in `GET /vehicle-models`.
- **Q13.** Whether a missing `Origin` header on `POST /enquiries` is rejected.
- **Q14.** Exact success status and body of `POST /enquiries`.
