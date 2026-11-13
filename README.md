# smart-paywall-proxy

Paywall-bypass front end. Given `/?url=<article>` it:

1. returns the cached copy from Redis, if there is one;
2. otherwise asks the `13ft` and `ladder-go` helper services in turn, 13ft first,
   skipping any that time out, fail, or return a block page;
3. otherwise redirects to archive.today.

Successful pages are stripped of scripts, served with `script-src 'none'`, and cached
for 5 to 60 minutes depending on the site.

Endpoints: `/` (form, or `?url=…&refresh=1`), `/archive?url=…`, `/health`, `/stats`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `TIMEOUT` | `5000` | Per-provider budget in ms, including the body |
| `MAX_BYTES` | `5242880` | Larger provider responses count as a failure |
| `REDIS_URL` | `redis://redis:6379` | Cache; optional, the app keeps working without it |
| `LADDER13FT_URL` | `http://ladder13ft:5000` | 13ft provider (its gunicorn listens on 5000) |
| `LADDER_GO_URL` | `http://ladder-go:8080` | ladder-go provider |
| `ALLOW_PRIVATE_TARGETS` | `false` | Permit targets on loopback, LAN and other private ranges |

## Safety

It fetches whatever URL it is given, so:

- only `http`/`https` URLs without credentials are accepted;
- targets that are, or resolve to, private, loopback or link-local addresses are
  refused with a 400, as are `localhost`, `.local`, `.internal` and single-label names;
- the providers still resolve names themselves, so that check is defence in depth.
  The real control is network policy: the cluster manifests stop the provider pods
  from reaching private address ranges. Keep the service on the LAN.

## Layout

```text
src/server.js     startup and graceful shutdown
src/app.js        routes and the cache-then-providers-then-archive flow
src/providers.js  provider order, cache TTLs, size- and time-limited fetching
src/url.js        URL validation and private-address checks
src/detect.js     block and challenge page detection
src/sanitize.js   script stripping and <base> injection
src/cache.js      Redis cache that never blocks a request; in-memory cache for tests
src/views.js      the home page
test/             node:test suites (no extra dependencies)
```

## Develop

```sh
npm ci
npm test
docker compose up --build   # full stack on http://localhost:3000
```

## Release

```sh
git tag v2.0.0 && git push origin v2.0.0
```

The `build` workflow runs the tests, then publishes
`ghcr.io/cookingmeister/smart-paywall-proxy:2.0.0`. The first publish creates the package as
private; set it to public once under the package's settings on GitHub so the cluster
can pull it without a credential.
