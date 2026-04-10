# lanhost

Proxy your local dev server over LAN so you can test it on mobile — with an optional password and QR code.

## Install

```sh
npm install -g lanhost
```

## Usage

```sh
lanhost <port>
```

```sh
lanhost 3000
```

Starts a proxy on port `3001` (target port + 1) bound to `0.0.0.0`. Prints the LAN URL and a QR code to scan on mobile.

## Config

Create a `.lanhost` file in your project root (it's automatically added to `.gitignore`):

```json
{
  "password": "secret",
  "proxyPort": 4000,
  "sessionExpiry": "8h",
  "name": "my-app"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `password` | none | Password required to access the proxy |
| `proxyPort` | `port + 1` | Port the proxy listens on |
| `sessionExpiry` | `8h` | Session lifetime — `h`, `m`, or `s` suffix |
| `name` | package name or dir name | mDNS service name (accessible as `name.local`) |

## License

MIT
