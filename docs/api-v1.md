# FullCharge API v1 contract

Base path: `/api/v1`. This document is the source of truth for the v1 routes. The web app, the future mobile app and the contract test (T1-33) all build against it. Changes inside v1 are additive only; a breaking change goes to `/api/v2`.

Items marked **Provisional** are not final: the decision records leave them open, or a confirmation is pending. Clients must not hard-code them, and they may change before v1 is frozen. Everything else is the contract.

All example values are fake (`example.test`, `Sample Station A`, made-up ids and coordinates).

## 1. Conventions

### 1.1 Auth modes

Every route declares exactly one mode.

| Mode | Meaning |
|---|---|
| `none` (anonymous) | No credential is read. Public reads ignore any cookie or token that is sent. `DELETE /session` is the one `none` route that reads the cookie, only to find the session to remove (section 3.9). |
| `user` | A signed-in user. |
| `admin` | A signed-in user who is currently an administrator. Admin routes live under `/api/admin/*` and `/api/analytics/*`, not under `/api/v1`, and are outside this contract. |

Credentials for `user`:

- **Session cookie.** An opaque, server-side session in an httpOnly cookie, created by `POST /session`. The cookie is `__Host-fc_session` (Secure) in deployed environments and `fc_session` on local http. The cookie value is random and never appears in a response body.
- **Bearer token.** `Authorization: Bearer <ID token>` where the token is a Firebase ID token. Intended for the future mobile app. A request with a Bearer header does not use the cookie.

Both credentials resolve to the same user context, so no endpoint behaves differently by credential, except for the CSRF rule below. For a cookie session: an unknown session row returns 401 `auth_invalid`; an expired one `auth_expired`; one created before the user's revocation time `auth_revoked`; and a deleted account `account_deleted`.

Whether a user is an administrator is computed on the server on each request. It is never taken from a request field or a token claim. A client learns it only from the `isAdmin` flag on `GET /me` and in the `POST /session` response.

### 1.2 CSRF rule

Applies to every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) authenticated by cookie, to `POST /session` itself, and to `DELETE /session` and `POST /enquiries`.

- If `Sec-Fetch-Site` is present, it must be `same-origin`.
- Otherwise the `Origin` header must equal the configured app origin.
- If neither header is present, the request is rejected.
- A failure returns 403 `forbidden`.
- The exemption applies only to a verified Bearer token on `user` and `admin` routes, because such a request carries no ambient credential. Routes with auth mode `none` always apply the check, whatever `Authorization` header is present.

### 1.3 Errors

Standard error body:

```json
{ "error": { "code": "not_found", "message": "Station not found.", "details": {} } }
```

`details` is optional. `message` is a fixed, human-readable string; it never contains internal detail, stack traces or personal data.

| Code | HTTP | Notes |
|---|---|---|
| `validation_failed` | 400 | Bad query string or path parameter. Also a malformed JSON body (**Provisional**). |
| `validation_failed` | 422 | Well-formed JSON body that fails validation. `details.fields` maps a field name to a message. |
| `invalid_cursor` | 400 | **Provisional.** A cursor that is malformed or does not match the request's filters and sort. |
| `not_available` | 400 | A sort that exists in the schema but is not offered yet. |
| `auth_missing`, `auth_invalid`, `auth_expired`, `auth_revoked`, `account_deleted` | 401 | |
| `forbidden` | 403 | Includes a failed CSRF check. |
| `not_found` | 404 | |
| `station_gone` | 404 | The station no longer exists. `details.mergedInto` holds the replacement id when it was merged. |
| `conflict`, `account_conflict` | 409 | `account_conflict` is returned only by `POST /session`. |
| `payload_too_large` | 413 | **Provisional.** A JSON body over 16 KB, on every route. |
| `unsupported_media_type` | 415 | **Provisional.** A body request whose `Content-Type` is not `application/json`. |
| `rate_limited` | 429 | Carries a `Retry-After` header in seconds. |
| `internal` | 500 | |

Two documented exceptions do not use the standard envelope: the field-error 400 of `POST /enquiries` (section 3.18) and the 503 of `GET /health` (section 3.7, **Provisional**).

### 1.4 Request bodies

- JSON only, `Content-Type: application/json`.
- Maximum body size is 16 KB.
- Every string has a length cap. Every enum is closed. Unknown body fields are ignored. Unknown query parameters are ignored.

### 1.5 Pagination

Paginated lists return:

```json
{ "items": [], "total": 0, "excludedUnknown": 0, "nextCursor": null, "hasMore": false }
```

- `limit` defaults to 20 and is at most 50. A larger value returns 400 `validation_failed`.
- `cursor` is an opaque string; clients must not parse it. A cursor is only valid with the same filters and sort that produced it; otherwise 400 `invalid_cursor`.
- `total` counts every match across all pages. It is not the length of `items`. Sorting never changes `total`: items with an unknown sort key are placed last, not dropped.
- `excludedUnknown` appears only on station lists and markers (section 1.6). Other paginated lists return `items`, `nextCursor`, `hasMore` and `total` only.

### 1.6 `excludedUnknown`

When a filter is active, a station whose value for that filter is unknown is not returned. `excludedUnknown` says how many stations were left out for that reason. It is the number of stations that would match if every unknown value were treated as a match, minus the number that match strictly. It covers every active filter that can be unknown: connector type, current, power, availability, price and amenities. With no active filter it is 0.

### 1.7 Rate limits

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

- Public reads (auth mode `none`, GET) send `Cache-Control: public, max-age=30`, except `GET /health`, which sends `no-store`. This is a browser cache only.
- Public reads are the same for every caller and contain no per-user fields. Saved-station state comes from `GET /me/shortlist`.
- `me`, `me/*`, `session`, `health` and all `POST` responses send `Cache-Control: no-store`.
- Server-side, station reads use a cache that is bypassed gracefully if unavailable.
- Bounding-box requests are rounded outward to a 0.01 degree grid, and the query uses the rounded box. A response can therefore include stations slightly outside the requested box.
- Request coordinates and search text are never stored or logged.

### 1.10 Formats

- Times are ISO 8601 UTC strings (`2030-01-01T10:00:00Z`).
- `distanceKm` is rounded to 0.1.
- Money is INR per kWh, as a number, and is present only when the unit is known.
- Ids are opaque strings. Do not parse them.
- Missing values: enums use the member `UNKNOWN`; numbers and strings use `null`.

### 1.11 Versioning

Within v1 the API changes additively: new endpoints, new optional parameters, new response fields. Clients must ignore unknown response fields. Removing or renaming a field, or changing a type or meaning, requires `/api/v2`.

## 2. Shared types

### 2.1 Availability

```ts
type AvailabilityState = "AVAILABLE" | "LIMITED" | "UNAVAILABLE" | "UNKNOWN";
type Confidence = "LIVE" | "RECENT" | "UNKNOWN";   // Provisional (T1-05)

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
- The `Confidence` values are **Provisional**; they follow the availability service (T1-05).

### 2.2 Freshness

A station carries:

| Field | Type | Meaning |
|---|---|---|
| `lastSourceUpdate` | string or null | Time reported by the data source, or null if it reports none. |
| `lastFullchargeUpdate` | string | When FullCharge last successfully observed the record. |

Each `Connector` (detail only, section 2.6) carries the same two fields. `ConnectorSummary` does not. A source's per-connector time means "last changed", so `lastSourceUpdate` can be older than the observation time; freshness is judged from `lastFullchargeUpdate`. The stored internal "last updated" column is never exposed.

### 2.3 Connector status (per connector)

`ConnectorSourceStatus`: `AVAILABLE`, `OCCUPIED`, `FAULTED`, `UNKNOWN`. **Provisional.**

The server sends `status: "UNKNOWN"` whenever the connector's `confidence` is not `LIVE` or `RECENT`. Clients map these to display words; raw enum names are not for display.

### 2.4 Connector types

`ConnectorType` (**Provisional**): `CCS2`, `CHADEMO`, `TYPE2`, `TYPE1`, `GB_T`, `BHARAT_AC`, `BHARAT_DC`, `WALL_SOCKET`, `UNKNOWN`.

`CurrentType` (**Provisional**): `AC`, `DC`, `UNKNOWN`.

- `UNKNOWN` is a member of both enums and appears on station connectors whose source did not say. It never matches a filter. It never appears in a vehicle model or in a user's manual vehicle list. `connectorTypes=UNKNOWN` in a query returns 400. (The data-model change that adds these members is task T0-07.)
- The `connectorTypes` query filter on stations is literal: `CCS2` returns only CCS2 connectors.

**Vehicle compatibility.** A vehicle's compatible set is the union of its model's AC and DC types (or the user's manual list), plus `TYPE2` whenever the set contains `CCS2`, because a CCS2 inlet also takes a Type 2 AC plug. The reverse never applies: a vehicle with only `TYPE2` does not match `CCS2`.

- The set is computed by the server and is never stored. It is deduplicated and its order is not significant. It is returned as `compatibleConnectorTypes` on each `GET /vehicle-models` item, and on `Vehicle` and `Vehicle.model` (section 3.11).
- The client sends that set as the ordinary `connectorTypes` filter. A station is compatible if at least one connector has a type in the set. Connector data is never altered to make this work.
- Power is never compared. The server never receives the user's vehicle, so station responses stay shareable between users.

### 2.5 Station summary

Returned in station lists. The fields below are final; there are no rating, score, reliability or usage fields.

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
  distanceKm?: number;           // present only when the request has a centre point
  availability: Availability;
  connectors: ConnectorSummary[];
  maxPowerKw: number | null;
  minPriceInrPerKwh: number | null;
  lastSourceUpdate: string | null;
  lastFullchargeUpdate: string;
}

interface ConnectorSummary {
  type: ConnectorType;
  current: "AC" | "DC" | "UNKNOWN";
  powerKw: number | null;
  count: number;                 // connectors of this type, current and power at the station
}
```

### 2.6 Station detail

```ts
interface StationDetail extends Omit<StationSummary, "connectors"> {
  connectors: Connector[];
  amenities: string[];           // empty array means none listed; keys are Provisional (below)
  hours: string | null;
  contact?: { phone?: string; url?: string };   // only when the source permits
  sourceName?: string;                          // only when branding is permitted
  operatorLink?: { label: string; url: string };   // Provisional: only when configured
  disclaimerKeys: string[];                     // Provisional (below)
}

interface Connector {
  id: string;
  type: ConnectorType;
  current: "AC" | "DC" | "UNKNOWN";
  powerKw: number | null;
  priceInrPerKwh: number | null;
  status: ConnectorSourceStatus;
  confidence: Confidence;
  lastSourceUpdate: string | null;
  lastFullchargeUpdate: string;
}
```

**Provisional keys.** The client maps keys to wording; unknown keys must be ignored.

- `disclaimerKeys`: `availability` (availability is indicative), `pricing` (prices may differ at the site), `hours` (hours come from the source).
- `amenities`: the key set comes from the data normaliser (T1-04) and is Provisional.

`operatorLink` appears only once an operator-app link has been configured for the station's network. Legal-page links are not in this API in v1 (deferred); the config endpoint returns versions only.

### 2.7 Marker

```ts
interface Marker {
  id: string;
  latitude: number;
  longitude: number;
  availability: AvailabilityState;
}
```

## 3. Endpoints

Unless stated, errors also include 413 and 415 for requests with a body, 429 (any endpoint) and 500.

### 3.1 `GET /stations`

Auth: `none`. Rate limit: IP bucket.

Returns servable stations. Either a centre point (`lat` and `lng`) or a `bbox` is required; neither returns 400 `validation_failed`. Order is by distance then id. With a centre point, distance is from that point. With only a bbox, the order uses the box centre and `distanceKm` is omitted from items.

Query. Names are final unless marked; `powerBand` value names are **Provisional**:

| Param | Type | Notes |
|---|---|---|
| `lat`, `lng` | number | Centre point. Both or neither. |
| `radiusKm` | number | 0 to 100, default 100. Ignored if `bbox` is given. |
| `bbox` | `west,south,east,north` | Alternative to centre and radius. Rounded outward to 0.01 degrees. |
| `connectorTypes` | comma list of `ConnectorType` | Literal match. `UNKNOWN` returns 400. See 2.4. |
| `current` | `AC` or `DC` | |
| `powerBand` | comma list: `LT_7`, `7_22`, `22_50`, `50_120`, `GT_120` | Bands are under 7, 7 to 22, over 22 to 50, over 50 to 120 and over 120 kW. Upper bounds are inclusive (except `LT_7`), so 22 kW AC is in `7_22` and 50 kW DC is in `22_50`. |
| `availableNow` | `true` | Matches stations with at least one connector whose status is `AVAILABLE`. That same connector must also satisfy `connectorTypes`, `current` and `powerBand` (for example a free 50 kW CCS2 connector). Only `true` is accepted. |
| `networks` | comma list of network names | Values come from `GET /networks`. |
| `maxPriceInrPerKwh` | number | Only stations with a known price can match. |
| `amenities` | comma list of amenity keys | |
| `sort` | `distance`, `price`, `power`, `availability` | Default `distance`. `price` ascending; `power` descending; `availability` in the order `AVAILABLE`, `LIMITED`, `UNAVAILABLE`, `UNKNOWN`. Null values are always last. `rating` and `reliability` return 400 `not_available`; any other value returns 400 `validation_failed`. |
| `limit`, `cursor` | | See 1.5. |

Connector-level filters (`connectorTypes`, `current`, `powerBand` and `availableNow`) must all hold on the same connector. Stations with an unknown value for an active filter are excluded and counted in `excludedUnknown`.

Response 200: `{ items: StationSummary[], total, excludedUnknown, nextCursor, hasMore }`.

Errors: 400 `validation_failed` (bad parameter, missing centre and bbox, a centre point without both coordinates, an inverted box, `limit` over 50), 400 `not_available`, 400 `invalid_cursor`.

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
    "connectors": [
      { "type": "CCS2", "current": "DC", "powerKw": 30, "count": 2 },
      { "type": "TYPE2", "current": "AC", "powerKw": 7.4, "count": 2 }
    ],
    "maxPowerKw": 30,
    "minPriceInrPerKwh": null,
    "lastSourceUpdate": "2030-01-01T10:00:00Z",
    "lastFullchargeUpdate": "2030-01-01T10:01:00Z"
  }],
  "total": 12,
  "excludedUnknown": 1,
  "nextCursor": "k7Qm2xVd9LwPz3Ta",
  "hasMore": true
}
```

### 3.2 `GET /stations/markers`

Auth: `none`. Rate limit: IP bucket.

Requires `bbox`. Accepts the same filters as 3.1. `sort`, `limit` and `cursor` are ignored. Returns at most 500 stations, the ones nearest the box centre. It is never silently cut.

Response 200: `{ items: Marker[], total, truncated, excludedUnknown }`. `total` is the full match count; `truncated` is true when `total` exceeds the items returned. No cursor.

Errors: 400 `validation_failed` (missing or invalid `bbox`, bad filter).

Example response:

```json
{ "items": [{ "id": "stn_example1", "latitude": 10.001, "longitude": 20.001, "availability": "LIMITED" }],
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

Query: `q` (string, 2 to 100 characters after trimming; required). A longer `q` returns 400.

Response 200:

```ts
{
  stations: { id: string; name: string; city: string | null; network: string | null; latitude: number; longitude: number }[];  // at most 10
  places:   { name: string; state: string | null; latitude: number; longitude: number }[];   // at most 5
  networks: string[];       // at most 5
  suggestions: string[];    // at most 5; closest terms, filled when the groups are empty
}
```

Typo tolerance is best effort; at launch the fallback is plain substring matching.

Errors: 400 `validation_failed` (`q` missing, under 2 or over 100 characters).

Example: `GET /api/v1/search?q=sample` returns `{"stations":[{"id":"stn_example1","name":"Sample Station A","city":"Exampleville","network":"Sample Network","latitude":10.001,"longitude":20.001}],"places":[],"networks":["Sample Network"],"suggestions":[]}`.

### 3.5 `GET /networks`

Auth: `none`. Rate limit: IP bucket.

Distinct, normalised network names among servable stations. Feeds the filter list.

Response 200: `{ items: string[] }` (not paginated).

Example: `{"items":["Sample Network","Other Sample Network"]}`.

### 3.6 `GET /config`

Auth: `none`. Rate limit: IP bucket.

Public runtime settings. The shape is **Provisional** (T1-16):

```ts
{
  availability: { liveMaxAgeMin: number; recentMaxAgeMin: number };  // thresholds in effect
  flags: Record<string, boolean>;
  legal: { privacyVersion: string; termsVersion: string };           // current versions
  helpline: string | null;
  minAppVersion: string | null;
}
```

Legal-page URLs and operator-app routing are not in config in v1 (deferred; `operatorLink` on station detail covers the one case the web app uses).

Example: `{"availability":{"liveMaxAgeMin":15,"recentMaxAgeMin":60},"flags":{},"legal":{"privacyVersion":"2030-01","termsVersion":"2030-01"},"helpline":null,"minAppVersion":null}`.

### 3.7 `GET /health`

Auth: `none`. Rate limit: IP bucket. `no-store`. No stated budget.

Response 200: `{ status: "ok", db: "ok", version: string }`. If the database check fails: 503 `{ status: "degraded", db: "down", version }` (**Provisional**). This is an exception to the standard error envelope. It leaks no host or connection detail.

### 3.8 `POST /session`

Auth: `none` (the Firebase ID token in the body is the credential). Rate limit: 10 per minute per IP. CSRF rule applies. `no-store`.

Request: `{ "idToken": string }`. The token must be recent: sign-in within the last 5 minutes.

Response 200: `{ displayName: string | null, isAdmin: boolean }`, and sets the session cookie. No token is ever in the body.

Session lifetime is absolute (no sliding): 14 days for a user, 8 hours when the account is administrator-eligible. Cookie `Max-Age` matches.

Errors: 401 `auth_invalid`, `auth_expired` (token, or token too old); 403 `forbidden` (CSRF); 409 `account_conflict` (the identity cannot be bound to the existing account); 422 `validation_failed`.

Example: `POST /api/v1/session` body `{"idToken":"example-token"}` returns `{"displayName":"Sample User","isAdmin":false}` with a `Set-Cookie` header.

### 3.9 `DELETE /session`

Auth: `none` (amends ADR-0018, which listed this route as `user`). CSRF rule applies. This is the exception to the rule that `none` routes read no credential: the route reads the session cookie, only to delete the matching session row, if any.

It always clears the session cookie and the non-sensitive "signed in" hint cookie, and always returns 204 with no body, whether or not a session existed. Token clients (the mobile app, on hold) sign out by discarding their token and do not call this route; a call with a Bearer header is still subject to the CSRF check.

Errors: 403 `forbidden` (CSRF).

### 3.10 `/me`

Auth: `user`. `no-store`. The write rate limit applies to mutations.

**`GET /me`** returns:

```ts
{
  id: string;
  displayName: string | null;
  email: string | null;        // only if verified
  phone: string | null;
  isAdmin: boolean;
  requiredConsents: { kind: "PRIVACY" | "TERMS"; version: string }[];  // current versions not yet accepted (accepted and not withdrawn since)
  onboardingComplete: boolean; // true when requiredConsents is empty
}
```

**`PATCH /me`** body `{ displayName: string }` (1 to 60 characters, trimmed). Returns the same shape as `GET /me`. Errors: 422.

**`DELETE /me`** erases the account. The user's vehicles, shortlist, sessions, reviews and the reports they filed are deleted. All personal data on the user row is blanked, and the row itself is kept, anonymised. Consent records and audit entries stay linked to that row's id. Existing sessions stop working. Response 204. Errors: 401, 403.

Example: `GET /api/v1/me` returns `{"id":"usr_example1","displayName":"Sample User","email":null,"phone":null,"isAdmin":false,"requiredConsents":[{"kind":"PRIVACY","version":"2030-01"}],"onboardingComplete":false}`.

### 3.11 `/me/vehicles`

Auth: `user`. `no-store`.

```ts
interface Vehicle {
  id: string;
  vehicleModelId: string | null;     // a catalogue model
  connectorTypes: ConnectorType[];   // the manual set; empty when a model is used
  compatibleConnectorTypes: ConnectorType[];   // computed, see 2.4
  nickname: string | null;           // 1 to 40 characters when set
  model?: VehicleModelSummary;       // present when vehicleModelId is set
  createdAt: string;
}

interface VehicleModelSummary {      // Provisional shape
  make: string;
  model: string;
  variant: string | null;
  acConnectorTypes: ConnectorType[];
  dcConnectorTypes: ConnectorType[];
  compatibleConnectorTypes: ConnectorType[];   // computed, not stored
}
```

`model` always carries the model's own connector arrays, even if the model has since been deactivated, so a saved vehicle never loses its connectors.

- **`GET /me/vehicles`**: `{ items: Vehicle[], total, nextCursor, hasMore }`.
- **`POST /me/vehicles`**: body `{ vehicleModelId?: string, connectorTypes?: ConnectorType[], nickname?: string }`. Exactly one of `vehicleModelId` or a non-empty `connectorTypes` is required. The model must be active. `connectorTypes` must not contain `UNKNOWN`. Returns 201 with the `Vehicle`. A user may have at most 10 vehicles; the 11th returns 409 `conflict`.
- **`PATCH /me/vehicles/{id}`**: any subset of `vehicleModelId`, `connectorTypes` and `nickname`; each accepts `null` (`connectorTypes`: an array or `null`). Setting a model clears `connectorTypes`; setting `connectorTypes` clears the model. The vehicle must end with exactly one of the two, otherwise 422 `validation_failed`. Sending a non-null `vehicleModelId` and a non-null `connectorTypes` in the same PATCH also returns 422. Returns the `Vehicle`.
- **`DELETE /me/vehicles/{id}`**: 204. The last vehicle may be deleted.

A user can reach only their own vehicles; another user's id returns 404. No registration number is stored.

Errors: 401, 403, 404 `not_found`, 409 `conflict`, 422 `validation_failed` (for example an inactive model).

Example: `POST /api/v1/me/vehicles` body `{"connectorTypes":["TYPE2"],"nickname":"Sample car"}` returns 201 `{"id":"veh_example1","vehicleModelId":null,"connectorTypes":["TYPE2"],"compatibleConnectorTypes":["TYPE2"],"nickname":"Sample car","createdAt":"2030-01-01T10:00:00Z"}`.

### 3.12 `/me/consents`

Auth: `user`. `no-store`. Records are append-only: accepting and withdrawing each add a record; none is edited or deleted.

```ts
interface ConsentRecord {
  kind: "PRIVACY" | "TERMS";
  version: string;
  action: "ACCEPT" | "WITHDRAW";
  at: string;
}
```

- **`GET /me/consents`**: `{ items: ConsentRecord[] }`, newest first. Not paginated.
- **`POST /me/consents`**: body `{ kind, version, action }`. Returns 201 with the new `ConsentRecord`. Accepting requires the current version from `GET /config`; any other version returns 422.

Which versions are still owed is on `GET /me` as `requiredConsents`.

Example: `POST /api/v1/me/consents` body `{"kind":"PRIVACY","version":"2030-01","action":"ACCEPT"}` returns 201 `{"kind":"PRIVACY","version":"2030-01","action":"ACCEPT","at":"2030-01-01T10:00:00Z"}`.

### 3.13 `/me/shortlist`

Auth: `user`. `no-store`.

- **`GET /me/shortlist`**: stations are grouped on the server by geographic state.

  ```ts
  {
    groups: { state: string | null; items: ShortlistItem[] }[];   // null state: clients show "Other"
    gone: { id: string; name: string; savedAt: string }[];
  }
  ```

  `ShortlistItem` is a `StationSummary` without `distanceKm`, plus `savedAt: string`. A station removed from the listing appears under `gone`.
- **`PUT /me/shortlist/{stationId}`**: saves the station. Idempotent. Response 204. 404 `not_found` if the station is unknown, removed or merged.
- **`DELETE /me/shortlist/{stationId}`**: removes it. Idempotent, 204 even if it was not saved.

Public station responses never carry saved state.

Example: `PUT /api/v1/me/shortlist/stn_example1` returns 204.

### 3.14 `/me/reviews/{stationId}`

Auth: `user`. Reviews are visible as soon as they are submitted; an administrator can hide one afterwards. One review per user per station. There is no collection route for a user's reviews.

```ts
interface Review {
  id: string;
  stationId: string;
  rating: number;         // integer 1 to 5
  comment: string | null; // plain text, up to 500 characters
  createdAt: string;
  updatedAt: string;
}
```

- **`GET /me/reviews/{stationId}`**: 200 with the user's `Review`, or 200 with the JSON value `null` if there is none.
- **`PUT /me/reviews/{stationId}`**: creates or replaces the user's review. Body `{ rating: number, comment?: string }`. Returns 200 with the `Review`. If an administrator has hidden the review, editing it does not unhide it. 404 if the station is unknown or not servable. 422 on bad rating or comment.
- **`DELETE /me/reviews/{stationId}`**: 204, idempotent.

Comments are stored and returned as plain text. Clients must render them as text, never as markup.

Example: `PUT /api/v1/me/reviews/stn_example1` body `{"rating":4,"comment":"Sample comment"}` returns `{"id":"rev_example1","stationId":"stn_example1","rating":4,"comment":"Sample comment","createdAt":"2030-01-01T10:00:00Z","updatedAt":"2030-01-01T10:00:00Z"}`.

### 3.15 `GET /stations/{id}/reviews`

Auth: `none`. Rate limit: IP bucket.

Returns visible (not hidden) reviews for the station, newest first. Query: `limit`, `cursor`.

```ts
{
  items: { id: string; authorName: string; rating: number; comment: string | null; createdAt: string }[];
  total: number;                // visible reviews
  average: number | null;       // visible reviews only, rounded to 0.1; null below 5 reviews
  nextCursor: string | null;
  hasMore: boolean;
}
```

`authorName` is the first name and last initial only. If the author has no usable name, it is `"Anonymous"`. Errors: 404 `not_found`, `station_gone`.

Example: `{"items":[{"id":"rev_example1","authorName":"Sample U.","rating":4,"comment":"Sample comment","createdAt":"2030-01-01T10:00:00Z"}],"total":1,"average":null,"nextCursor":null,"hasMore":false}`.

### 3.16 `POST /reviews/{id}/report`

Auth: `user`. CSRF rule applies. The write rate limit applies.

Body: `{ reason: "SPAM" | "ABUSIVE" | "IRRELEVANT" | "OTHER", note?: string }`. `note` is plain text, at most 300 characters.

Response 204. A user can report a given review once; a repeat returns 409 `conflict`. Errors: 401, 403, 404 `not_found` (unknown or hidden review), 422.

Example: `POST /api/v1/reviews/rev_example1/report` body `{"reason":"SPAM"}` returns 204.

### 3.17 `GET /vehicle-models`

Auth: `none`. Rate limit: IP bucket. Public and cacheable.

Returns the active catalogue. Not paginated.

```ts
{
  items: {
    id: string;
    make: string;
    model: string;
    variant: string | null;
    acConnectorTypes: ConnectorType[];
    dcConnectorTypes: ConnectorType[];
    compatibleConnectorTypes: ConnectorType[];   // computed, see 2.4
    maxAcKw: number | null;
    maxDcKw: number | null;
    batteryKwh: number | null;
  }[];
}
```

Connector arrays never contain `UNKNOWN`. Each catalogue row is backed by a manufacturer source and a verification date; neither is returned here. The catalogue lists only what a source states.

A client builds a vehicle's station filter by sending `compatibleConnectorTypes` as `connectorTypes` (see 2.4).

Example: `{"items":[{"id":"vm_example1","make":"Sample Make","model":"Sample Model","variant":null,"acConnectorTypes":["TYPE2"],"dcConnectorTypes":["CCS2"],"compatibleConnectorTypes":["CCS2","TYPE2"],"maxAcKw":7.4,"maxDcKw":50,"batteryKwh":30}]}`.

### 3.18 `POST /enquiries`

Auth: `none`. Rate limit: 5 per hour per IP. `no-store`. This route matches the shipped request contract in `src/lib/enquiries.ts`.

**Origin check.** The CSRF rule in 1.2 applies: `Sec-Fetch-Site` must be `same-origin`; otherwise `Origin` must equal the app origin; if neither header is present, 403 `forbidden` (standard envelope).

**Request** (JSON, 16 KB cap):

```ts
interface EnquiryRequest {
  name: string;          // required after trimming, at most 100 characters
  email: string;         // required, valid address, at most 254 characters
  organisation: string;  // optional; send "" when blank; at most 150 characters
  type: "BUSINESS" | "OPERATOR" | "OTHER";
  message: string;       // optional; send "" when blank; at most 2000 characters
  consent: true;         // must be literally true
  website: string;       // honeypot: always "" from a real user; at most 200 characters
}
```

A `type` value outside the three above returns 400 with no entry for it (and no `fields` at all if nothing else failed), and the form shows its generic error.

**Honeypot.** The honeypot is checked before any validation. If `website` is non-empty, the server returns exactly the same response as a real success and stores nothing. A client cannot tell the difference.

**Responses.**

- 204 with no body, on success and on a honeypot hit.
- 400 `EnquiryErrorBody`:

  ```ts
  interface EnquiryErrorBody {
    fields?: Partial<Record<"name" | "email" | "message" | "consent", string>>;
  }
  ```

  `fields` is keyed by form field, one message per field. There is no `organisation` or `type` key: a failure on either returns 400 with no entry for it (and no `fields` at all if nothing else failed), and the form shows its generic error. This body is not the standard envelope. For field errors the route builds this body itself instead of using the wrapper's standard validation mapping (which would return 422 with `details.fields`); all other failures on this route use the standard envelope.
- 403 `forbidden`: Origin check failed.
- 413 `payload_too_large`, 415 `unsupported_media_type`: standard envelope.
- 429 `rate_limited`: more than 5 per hour from one IP, with `Retry-After`.

No IP address is stored. No email notification is sent in v1.

Example: `POST /api/v1/enquiries`

```json
{ "name": "Sample Person", "email": "person@example.test", "organisation": "", "type": "OTHER",
  "message": "", "consent": true, "website": "" }
```

Response: `204`.

## 4. Route and auth summary

| Route | Methods | Auth |
|---|---|---|
| `/health`, `/config` | GET | none |
| `/stations`, `/stations/markers`, `/stations/{id}`, `/stations/{id}/reviews` | GET | none |
| `/search`, `/networks`, `/vehicle-models` | GET | none |
| `/session` | POST | none (ID token in body) |
| `/session` | DELETE | none (reads the cookie to find the session; amends ADR-0018, was user) |
| `/enquiries` | POST | none |
| `/me` | GET, PATCH, DELETE | user |
| `/me/vehicles`, `/me/vehicles/{id}` | GET, POST, PATCH, DELETE | user |
| `/me/consents` | GET, POST | user |
| `/me/shortlist`, `/me/shortlist/{stationId}` | GET, PUT, DELETE | user |
| `/me/reviews/{stationId}` | GET, PUT, DELETE | user |
| `/reviews/{id}/report` | POST | user |

## 5. Open questions

- **Q5.** The final `disclaimerKeys` and amenity key sets (section 2.6) depend on the data normaliser and wording decisions.
- **Q6.** `Confidence` values and `ConnectorSourceStatus` (sections 2.1, 2.3) follow the availability service and may change with it.
- **Q7.** Names of the `powerBand` values, and the status codes marked Provisional in 1.3 (`invalid_cursor`, `payload_too_large`, `unsupported_media_type`, malformed-JSON 400, the `GET /health` 503), because no decision record fixes them.
- **Q8.** `GET /config` fields and `operatorLink` on station detail (T1-16, and the unset operator-routing values).
