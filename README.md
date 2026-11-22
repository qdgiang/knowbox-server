# Knowbox Explorer

The browser application for Knowbox. Its HTML, CSS and ES modules live in
`web/`. The Rust CLI supplies API version 1, Markdown previews, search,
history and the shared write operations.

## Local browser

Use Knowbox 1.3 or later with API version 1. From this checkout, run:

```sh
knowbox serve --assets "$PWD/web" --open
knowbox serve --assets "$PWD/web" --read-only --port 7878
```

The URL printed by the CLI connects the browser to that process. The second
command also works on a headless host. Forward the selected loopback port over
SSH and open the printed URL on the client.

## Package the site

```sh
bash scripts/package-web.sh
```

Extract the resulting archive and pass its `web/` directory to `--assets`
or set `KNOWBOX_WEB_ROOT` to that directory when starting the gateway.
The site needs no Node build step. Bundle 1.1 adds Agent, Insights and
Mermaid rendering. The Agent and Insights screens appear with Knowbox 1.4
or later. Miss projection uses the configured embedding provider only when
you select it.

## Read-only gateway

Use `deploy/start.sh` with Docker Compose. Set `KNOWBOX_BINARY` to the
installed CLI, `KNOWBOX_DATA` to the KB directory, and `KNOWBOX_WEB_ROOT`
to the unpacked assets. Set `KNOWBOX_TRUST_RULES` to an nginx configuration
defining `$trusted_network` and `$allowed_host` for your installation.
Use the checked-in `deploy/trust.conf` as the template. The gateway listens on
`127.0.0.1:7878` by default. Set `KNOWBOX_GATEWAY_BIND=0.0.0.0:7878` and
configure the Host and source allowlists for LAN access.
Set `KNOWBOX_TIME_ZONE` to the same time zone as scheduled maintenance so
day-based reports use the same date as the CLI.

The browser opens the read-only site without a login. The gateway sends its
private credential to the loopback API. The start script recreates that
backend so updated binaries are picked up and refreshes the credential.

## Browser checks

Run `bash scripts/check-browser.sh /path/to/knowbox /path/to/web` to test a
CLI and website pair in disposable Docker containers. It uses the pinned
Playwright Chromium version and tests both read-only and writable modes.
