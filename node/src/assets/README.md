# Proxy Client-Side Rewrite Scripts: s1.js & s2.js

## Overview

These scripts are designed to help with client-side URL rewriting when using a reverse proxy with wildcard subdomains. They ensure that all resource URLs (scripts, images, links, etc.) are correctly rewritten to work with your proxy setup.

---

## s1.js

### Purpose
- Rewrites root-relative URLs in specified HTML tags/attributes to include a subdomain path prefix.
- Useful for setups where the subdomain is encoded in the path (legacy pattern).

### How It Works
- Reads configuration from `window.proxyConfig` (injected by the proxy server).
- For each matching tag/attribute, rewrites URLs that start with `/` to include the subdomain path prefix (if not already present).
- Observes DOM mutations and attribute changes to rewrite new or changed elements.
- Runs a fallback interval every second to catch missed rewrites.

### Configuration
- Expects `window.proxyConfig` to have:
  - `tags`: Array of tag names (e.g., `["img", "link", "script", "iframe"]`)
  - `attributes`: Array of attribute names (e.g., `["href", "src", "content"]`)

### Example Usage
```html
<script>
  window.proxyConfig = {
    tags: ["img", "link", "script", "iframe"],
    attributes: ["href", "src", "content"]
  };
</script>
<script src="/assets/s1.js"></script>
```

### What Elements and Attributes Are Rewritten?
- All elements matching the configured tags and attributes. By default:
  - `<img src="/foo.png">` → `<img src="/subdomain/foo.png">`
  - `<link href="/style.css">` → `<link href="/subdomain/style.css">`
  - `<script src="/main.js">` → `<script src="/subdomain/main.js">`
  - `<iframe src="/frame.html">` → `<iframe src="/subdomain/frame.html">`
  - `<meta content="/some/path">` (if `meta` is in tags and `content` in attributes) → `<meta content="/subdomain/some/path">`
- Only root-relative URLs (starting with `/`) are rewritten, and only if not already prefixed with the subdomain path.

#### Example Table
| Before                                 | After                                 |
|----------------------------------------|---------------------------------------|
| `<img src="/foo.png">`                | `<img src="/subdomain/foo.png">`     |
| `<link href="/style.css">`            | `<link href="/subdomain/style.css">` |
| `<script src="/main.js">`             | `<script src="/subdomain/main.js">`  |
| `<iframe src="/frame.html">`          | `<iframe src="/subdomain/frame.html">`|

---

## s2.js

### Purpose
- General-purpose client-side URL rewriter for reverse proxies with wildcard subdomain support.
- Handles both absolute and relative URLs, and works for any target domain.

### How It Works
- Optionally reads `window.s2BaseUrl` and `window.s2TargetDomain` for configuration.
- Automatically detects the current subdomain and root domain from `window.location.host`.
- Rewrites URLs in `src`, `href`, and `srcset` attributes of `script`, `link`, and `img` tags to point to the correct proxy or target domain.
- Handles both absolute URLs (e.g., `https://app.target.com/foo.js`) and relative URLs (`/foo.js`).
- Observes DOM mutations and periodically rewrites tags to handle dynamic content.

### Configuration
- `window.s2BaseUrl` (optional): Override the base URL for rewriting.
- `window.s2TargetDomain` (optional): Set the target domain (e.g., `leonardo.ai`).
- If not set, tries to use `window.proxyConfig.targetDomain` or defaults to `example.com`.

### Example Usage
```html
<script>
  window.s2TargetDomain = "leonardo.ai";
  // window.s2BaseUrl = "https://app.leonardo.ai"; // Optional
</script>
<script src="/assets/s2.js"></script>
```

### What Elements and Attributes Are Rewritten?
- All `<script src>`, `<link href>`, `<img src>`, and `<img srcset>` attributes are rewritten if they:
  - Are absolute URLs to the target domain (e.g., `https://app.leonardo.ai/foo.js`)
  - Are root-relative URLs (e.g., `/foo.js`)
- The script will:
  - Rewrite absolute URLs to the proxy domain, preserving subdomain
  - Rewrite relative URLs to the current proxy subdomain
  - Leave all other URLs unchanged

#### Example Table
| Before (in HTML)                                         | After (on https://app.leonardo.anon404.me)                |
|---------------------------------------------------------|-----------------------------------------------------------|
| `<img src="/foo.png">`                                 | `<img src="https://app.leonardo.anon404.me/foo.png">`    |
| `<link href="/style.css">`                             | `<link href="https://app.leonardo.anon404.me/style.css">`|
| `<script src="/main.js">`                              | `<script src="https://app.leonardo.anon404.me/main.js">` |
| `<img src="https://app.leonardo.ai/bar.png">`          | `<img src="https://app.leonardo.anon404.me/bar.png">`    |
| `<img srcset="/a.png 1x, /b.png 2x">`                 | `<img srcset="https://app.leonardo.anon404.me/a.png 1x, https://app.leonardo.anon404.me/b.png 2x">` |
| `<img srcset="https://app.leonardo.ai/a.png 1x">`      | `<img srcset="https://app.leonardo.anon404.me/a.png 1x">`|
| `<script src="https://cdn.example.com/lib.js">`        | (unchanged)                                               |
| `<img src="https://otherdomain.com/x.png">`            | (unchanged)                                               |

---

## When to Use Which Script
- **s1.js**: Use if your proxy encodes the subdomain in the path (legacy pattern).
- **s2.js**: Use for modern wildcard subdomain proxies. More flexible and recommended for most setups.

---

## Notes
- Both scripts are designed to be injected by your proxy server, but can be used manually if you provide the required configuration.
- s2.js is more general and recommended for new projects. 