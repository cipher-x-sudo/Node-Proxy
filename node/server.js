const express = require('express');
const httpProxy = require('http-proxy');
const cors = require('cors');

const BRIDGE_PORT = 40313; // The port this bridge will listen on
const PROXY_TARGET = 'http://localhost:40313'; // Where simple-proxy.js is running

const app = express();
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Forward all requests to the simple-proxy.js server
app.all('/*', (req, res) => {
    proxy.web(req, res, { target: PROXY_TARGET }, (err) => {
        res.status(502).send('Proxy error: ' + err.message);
    });
});

app.listen(BRIDGE_PORT, () => {
    console.log(`Bridge server running on port ${BRIDGE_PORT}, forwarding to ${PROXY_TARGET}`);
}); 