# server.js - Detailed Documentation

This file is the entry point for the bridge server. It forwards all incoming requests to the main proxy server.

---

```js
const express = require('express');
```
*Imports the Express framework for creating the HTTP server.*

```js
const httpProxy = require('http-proxy');
```
*Imports the http-proxy library to forward HTTP requests to another server.*

```js
const cors = require('cors');
```
*Imports the CORS middleware to handle Cross-Origin Resource Sharing.*

```js
const BRIDGE_PORT = 40313; // The port this bridge will listen on
```
*Defines the port number for the bridge server.*

```js
const PROXY_TARGET = 'http://localhost:40313'; // Where simple-proxy.js is running
```
*Defines the target address to which requests will be forwarded. (Note: This is likely a placeholder for the main proxy server.)*

```js
const app = express();
```
*Creates an Express application instance.*

```js
const proxy = httpProxy.createProxyServer({ changeOrigin: true });
```
*Creates a proxy server instance with the option to change the origin of the host header to the target URL.*

```js
app.use(cors({ origin: '*', credentials: true }));
```
*Enables CORS for all origins and allows credentials (cookies, etc.) to be sent.*

```js
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```
*Adds middleware to parse incoming JSON and URL-encoded payloads.*

```js
// Forward all requests to the simple-proxy.js server
app.all('/*', (req, res) => {
    proxy.web(req, res, { target: PROXY_TARGET }, (err) => {
        res.status(502).send('Proxy error: ' + err.message);
    });
});
```
*Forwards all HTTP requests to the proxy target. If an error occurs, responds with a 502 status and the error message.*

```js
app.listen(BRIDGE_PORT, () => {
    console.log(`Bridge server running on port ${BRIDGE_PORT}, forwarding to ${PROXY_TARGET}`);
});
```
*Starts the server and logs a message indicating the port and target.*

---

**Summary:**
- This file sets up a simple bridge server that forwards all requests to another proxy server, handling CORS and parsing request bodies. It is useful for separating concerns or for local development setups. 