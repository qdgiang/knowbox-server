# Knowbox Explorer

- This repository owns the HTML, CSS, JavaScript, browser tests, static
  packaging and container gateway. The sibling `knowbox` repository owns
  data access and the versioned CLI API.
- Serve the assets locally. Keep the browser modules build-free, and record
  vendored source versions, hashes and licenses in `web/THIRD-PARTY.md`.
- Use text nodes for untrusted content. The Markdown view receives sanitized
  HTML from the CLI data API. Put raw examples in text nodes.
- Exercise browser mutations against disposable KBs. The Fedora gateway
  exposes the read-only API and uses a read-only data mount.
