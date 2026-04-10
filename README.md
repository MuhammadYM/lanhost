<p align="center">
  <img src="assets/banner.svg" alt="lanhost" width="514">
</p>

---

Proxy your local dev server over LAN so you can test it on mobile — with an optional password and QR code.

## Install

```sh
npm install -g lanhost
```

## Usage

Start your dev server as normal, then in a separate terminal run:

```sh
lanhost <port>
```

For example:

```sh
lanhost 3000
```

lanhost starts a proxy on `port + 1`.

That's it — no config file required.

## Config (optional)

To customise behaviour, create a `.lanhost` file in your project root. It is automatically added to `.gitignore` on first run.

**Bare minimum** (password only):

```json
{
  "password": "secret"
}
```

**All options:**

```json
{
  "password": "secret",
  "proxyPort": 4000,
  "sessionExpiry": "8h",
  "name": "my-app"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `password` | `string` | — | Password required to access the proxy. If omitted, no auth is enforced. |
| `proxyPort` | `number` | `port + 1` | Port the proxy listens on. |
| `sessionExpiry` | `string \| number` | `"8h"` | How long a login session lasts. Accepts `h`, `m`, or `s` suffix (e.g. `"30m"`, `"2h"`), or milliseconds as a number. |
| `name` | `string` | package name or directory name | mDNS service name — makes the proxy accessible as `name.local` on the same network. |

## License

MIT
