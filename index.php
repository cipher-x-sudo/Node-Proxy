<?php
// Load configuration
$config = require 'config.php';

// Extract configuration values
$proxyDomain = $config['proxyDomain'];
$targetDomain = $config['targetDomain'];
$subdomainMarker = $config['subdomainMarker'];
$tagsToOverride = $config['tagsToOverride'];
$attributesToOverride = $config['attributesToOverride'];
$proxyEnabled = $config['proxyEnabled'];
$userAgent = $config['userAgent'];
$httpProxy = $config['httpProxy'];

// Auto-detect and read cookies from JSON files
$cookieFiles = glob('cookies*.json');
$allCookies = [];
$allowedCookies = [];

foreach ($cookieFiles as $cookieFile) {
    $cookieData = json_decode(file_get_contents($cookieFile), true);
    if ($cookieData && is_array($cookieData)) {
        $allCookies = array_merge($allCookies, $cookieData);
        foreach ($cookieData as $cookie) {
            if (isset($cookie['name'])) {
                $allowedCookies[] = $cookie['name'];
            }
        }
    }
}

$allowedCookies = array_unique($allowedCookies);

// Initialize cookies array
$cookies = [];

// Process cookies from all files
foreach ($allCookies as $cookie) {
    if (isset($cookie['name']) && in_array($cookie['name'], $allowedCookies)) {
        $cookies[$cookie['name']] = $cookie['value'];
    }
}

// --- Request Processing ---
$requestUri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$queryString = $_SERVER['QUERY_STRING'] ?? '';

$cleanPath = $requestUri;

// Extract subdomain from path
if (preg_match("#^/([a-z0-9-]+){$subdomainMarker}(/.*)?$#i", $requestUri, $matches)) {
    $subdomain = $matches[1];
    $cleanPath = $matches[2] ?? '/';
    $targetHost = "{$subdomain}.{$targetDomain}";
} else {
    $targetHost = $targetDomain;
}


// Build target URL
$targetUrl = "https://{$targetHost}{$cleanPath}" . ($queryString ? "?{$queryString}" : '');


// --- Header Management ---
$headers = [];
$clientHeaders = getallheaders();

// Filter and modify headers
foreach ($clientHeaders as $name => $value) {
    $lowerName = strtolower($name);
    
    switch ($lowerName) {
        case 'host':
            $headers[] = "Host: {$targetHost}";
            break;
        case 'cookie':
            // Process cookies after collecting all headers
            break;
        case 'accept-encoding':
            $headers[] = "Accept-Encoding: identity"; // Force no encoding
            break;
        case 'referer':
            $headers[] = "Referer: " . str_replace($proxyDomain, $targetDomain, $value);
            break;
        case 'user-agent':
            $headers[] = "User-Agent: {$userAgent}";
            break;
        default:
            if (!in_array($lowerName, ['content-length', 'content-encoding'])) {
                $headers[] = "{$name}: {$value}";
            }
    }
}

// Add User-Agent if not present in client headers
if (!isset($clientHeaders['User-Agent'])) {
    $headers[] = "User-Agent: {$userAgent}";
}

// --- Cookie Management ---
$cookieHeader = http_build_query($cookies, '', '; ');
if (isset($_SERVER['HTTP_COOKIE'])) {
    $clientCookies = explode('; ', $_SERVER['HTTP_COOKIE']);
    foreach ($clientCookies as $cookie) {
        $parts = explode('=', $cookie, 2);
        if (in_array($parts[0], $allowedCookies)) {
            $cookieHeader .= "; {$cookie}";
        }
    }
}

// --- cURL Configuration ---
$ch = curl_init();
$options = [
    CURLOPT_URL => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_COOKIE => $cookieHeader,
    CURLOPT_POSTFIELDS => file_get_contents('php://input'),
    CURLOPT_ENCODING => '',
    CURLOPT_SSL_VERIFYPEER => false,
];

// HTTP Proxy Configuration (only if enabled)
if ($proxyEnabled) {
    $options[CURLOPT_PROXY] = $httpProxy['host'];
    $options[CURLOPT_PROXYPORT] = $httpProxy['port'];
    $options[CURLOPT_PROXYUSERPWD] = $httpProxy['username'] . ':' . $httpProxy['password'];
    $options[CURLOPT_PROXYTYPE] = CURLPROXY_HTTP;
}

$options[CURLOPT_HEADERFUNCTION] = function($curl, $headerLine) use ($proxyDomain) {
    $header = rtrim($headerLine);
    
    // Modify response headers
    if (stripos($header, 'Content-Encoding:') === 0) {
        return strlen($headerLine);
    }
    
    if (stripos($header, 'Set-Cookie') === 0) {
        $header = preg_replace(
            '/Domain=.*?;/i',
            "Domain={$proxyDomain};",
            $header
        );
        // Filter unwanted cookies
        foreach (['ttcsid'] as $blocked) {
            if (stripos($header, "{$blocked}=") !== false) {
                return strlen($headerLine);
            }
        }
    }
    
    if (!empty($header)) {
        header($header, false);
    }
    return strlen($headerLine);
};

// Handle POST/PUT
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $options[CURLOPT_POST] = true;
}

curl_setopt_array($ch, $options);

// --- Execute Request ---
$response = curl_exec($ch);
$error = curl_error($ch);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$body = substr($response, $headerSize);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// --- Selective URL Rewriting ---
$contentType = '';
foreach (headers_list() as $header) {
    if (stripos($header, 'Content-Type:') === 0) {
        $contentType = $header;
        break;
    }
}

// Handle JSON API responses
if (strpos($contentType, 'application/json') !== false) {
    $body = preg_replace_callback(
        '/https?:\/\/([a-z0-9-]+)\.'.preg_quote($targetDomain, '/').'(\/[^"\'\\\\]+)/i',
        function($matches) use ($proxyDomain, $subdomainMarker) {
            return "https://{$proxyDomain}/{$matches[1]}{$subdomainMarker}{$matches[2]}";
        },
        $body
    );
}

// Handle HTML content
if (strpos($contentType, 'text/html') !== false ||
    strpos($contentType, 'text/css') !== false) {
    // Comprehensive HTML element rewriting
    $body = preg_replace_callback(
        '/<(?:[^>]+)>/i', // Match all HTML tags
        function($matches) use ($proxyDomain, $targetDomain, $subdomainMarker) {
            return preg_replace(
                '/(href|src|poster|content|data-[a-z-]+)=(["\' ]*)(https?:)?\/\/([a-z0-9-]+)\.'.preg_quote($targetDomain, '/').'(\/[^"\'\\s>]*)/i',
                '$1=$2https://'.$proxyDomain.'/$4'.$subdomainMarker.'$5',
                $matches[0]
            );
        },
        $body
    );
}


// Add this specific regex pattern for stylesheet links
$body = preg_replace_callback(
    '/<link\b[^>]*\bhref=(["\'])(https?:\/\/)([a-z0-9-]+)\.'.preg_quote($targetDomain, '/').'(\/[^\1]*?)\1[^>]*>/i',
    function($matches) use ($proxyDomain, $subdomainMarker) {
        return str_replace(
            "{$matches[2]}{$matches[3]}.{$targetDomain}{$matches[4]}",
            "{$matches[2]}{$proxyDomain}/{$matches[3]}{$subdomainMarker}{$matches[4]}",
            $matches[0]
        );
    },
    $body
);

// JS Injection
$body = preg_replace_callback(
    '/<head\b[^>]*>(.*?)<\/head>/is',
    function($matches) use ($proxyDomain, $targetDomain, $subdomainMarker, $tagsToOverride, $attributesToOverride) {
        // Build attribute pattern for server-side replacement
        $attrPattern = implode('|', array_map(function($attr) {
            return preg_quote($attr, '/');
        }, $attributesToOverride));
        
        $processedHead = preg_replace(
            '/('.$attrPattern.')=(["\'])(https?:?\/\/+)([a-z0-9-]+)\.'.preg_quote($targetDomain, '/').'(\/[^"\'\\s>]*)/i',
            '$1=$2https://'.$proxyDomain.'/$4'.$subdomainMarker.'$5',
            $matches[1]
        );

        // Update config to include attributes
        $config = [
            'proxyDomain' => $proxyDomain,
            'targetDomain' => $targetDomain,
            'subdomainMarker' => $subdomainMarker,
            'tags' => $tagsToOverride,
            'attributes' => $attributesToOverride
        ];

        return "<head>{$processedHead}
            <script>
                window.proxyConfig = ".json_encode($config, JSON_HEX_TAG | JSON_UNESCAPED_SLASHES).";
            </script>
            <script src='/assets/s1.js?".time()."'></script>
            <script src='/assets/s2.js'></script>
        </head>";
    },
    $body
);

// Write to log file
file_put_contents('proxy.log', $log, FILE_APPEND);

// --- Response Processing ---
// Remove encoding headers
header_remove('Content-Encoding');

// Add security headers
header("Content-Security-Policy: default-src 'self' https: 'unsafe-inline' 'unsafe-eval'; script-src 'self' https: 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; img-src 'self' https: data: blob:; font-src 'self' https://cdn.hailuoai.video; connect-src 'self' https:;");
header("Access-Control-Allow-Origin: https://{$proxyDomain}");

// Send final response
http_response_code(curl_getinfo($ch, CURLINFO_HTTP_CODE));
echo $body;