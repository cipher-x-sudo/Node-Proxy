// Admin Panel JavaScript

const API_BASE = '/api/admin';
let currentConfig = {};

// Check authentication
function checkAuth() {
    const token = localStorage.getItem('adminToken');
    if (!token) {
        window.location.href = '/admin/login';
        return false;
    }
    return true;
}

// API request helper
async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (response.status === 401) {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin/login';
        return null;
    }

    return response;
}

// Show notification
function showNotification(message, isError = false) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${isError ? 'error' : ''}`;
    notification.classList.add('show');
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = e.target.dataset.view;
        showView(view);
    });
});

function showView(viewName) {
    // Update nav
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

    // Update views
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`${viewName}-view`).classList.add('active');

    // Update title
    const titles = {
        dashboard: 'Dashboard',
        config: 'Configuration',
        cookies: 'Cookies',
        history: 'History',
        users: 'Users',
    };
    document.getElementById('pageTitle').textContent = titles[viewName];

    // Load view data
    if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'config') {
        loadConfig();
    } else if (viewName === 'cookies') {
        loadCookies();
    } else if (viewName === 'history') {
        loadHistory();
    } else if (viewName === 'users') {
        loadUsers();
    }
}

// Load current user
async function loadCurrentUser() {
    const response = await apiRequest('/auth/me');
    if (response) {
        const data = await response.json();
        document.getElementById('currentUser').textContent = data.user.username;
    }
}

// Dashboard
async function loadDashboard() {
    const response = await apiRequest('/stats');
    if (response) {
        const data = await response.json();
        document.getElementById('stat-config').textContent = data.stats.configEntries;
        document.getElementById('stat-users').textContent = data.stats.users;
        document.getElementById('stat-history').textContent = data.stats.historyEntries;
    }
}

// Configuration
async function loadConfig() {
    const response = await apiRequest('/config');
    if (response) {
        const data = await response.json();
        currentConfig = data.config;

        // Populate form fields
        document.getElementById('config-proxyDomain').value = currentConfig.proxyDomain || '';
        document.getElementById('config-targetDomain').value = currentConfig.targetDomain || '';
        document.getElementById('config-userAgent').value = currentConfig.userAgent || '';
        document.getElementById('config-proxyEnabled').checked = currentConfig.proxyEnabled || false;
        document.getElementById('config-httpProxy.host').value = currentConfig.httpProxy?.host || '';
        document.getElementById('config-httpProxy.port').value = currentConfig.httpProxy?.port || '';
        document.getElementById('config-httpProxy.username').value = currentConfig.httpProxy?.username || '';
        document.getElementById('config-httpProxy.password').value = currentConfig.httpProxy?.password || '';
        document.getElementById('config-rewriteStatic').checked = currentConfig.rewriteStatic || false;
        document.getElementById('config-injectS1').checked = currentConfig.injectS1 || false;
        document.getElementById('config-skipRewriteDomains').value = (currentConfig.skipRewriteDomains || []).join('\n');
        document.getElementById('config-noCredentialsDomains').value = (currentConfig.noCredentialsDomains || []).join('\n');
    }
}

// Save configuration
document.getElementById('saveConfigBtn').addEventListener('click', async () => {
    const configUpdates = {
        'proxyDomain': document.getElementById('config-proxyDomain').value,
        'targetDomain': document.getElementById('config-targetDomain').value,
        'userAgent': document.getElementById('config-userAgent').value,
        'proxyEnabled': document.getElementById('config-proxyEnabled').checked,
        'httpProxy.host': document.getElementById('config-httpProxy.host').value,
        'httpProxy.port': parseInt(document.getElementById('config-httpProxy.port').value) || 0,
        'httpProxy.username': document.getElementById('config-httpProxy.username').value,
        'httpProxy.password': document.getElementById('config-httpProxy.password').value,
        'rewriteStatic': document.getElementById('config-rewriteStatic').checked,
        'injectS1': document.getElementById('config-injectS1').checked,
        'skipRewriteDomains': document.getElementById('config-skipRewriteDomains').value.split('\n').filter(d => d.trim()),
        'noCredentialsDomains': document.getElementById('config-noCredentialsDomains').value.split('\n').filter(d => d.trim()),
    };

    const response = await apiRequest('/config/bulk', {
        method: 'POST',
        body: JSON.stringify({ config: configUpdates }),
    });

    if (response) {
        const data = await response.json();
        if (data.success) {
            showNotification('Configuration saved successfully!');
            loadConfig();
        } else {
            showNotification('Failed to save configuration', true);
        }
    }
});

// Reload cache
document.getElementById('reloadConfigBtn').addEventListener('click', async () => {
    const response = await apiRequest('/config/reload', {
        method: 'POST',
    });

    if (response) {
        const data = await response.json();
        if (data.success) {
            showNotification('Configuration cache reloaded!');
        } else {
            showNotification('Failed to reload cache', true);
        }
    }
});

// History
async function loadHistory() {
    const response = await apiRequest('/config/history?limit=100');
    if (response) {
        const data = await response.json();
        const tbody = document.getElementById('historyTableBody');
        
        if (data.history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">No history available</td></tr>';
            return;
        }

        tbody.innerHTML = data.history.map(item => `
            <tr>
                <td>${item.key}</td>
                <td><code>${item.old_value || '-'}</code></td>
                <td><code>${item.new_value}</code></td>
                <td>${item.changed_by || '-'}</td>
                <td>${new Date(item.changed_at).toLocaleString()}</td>
            </tr>
        `).join('');
    }
}

// Users
async function loadUsers() {
    const response = await apiRequest('/users');
    if (response) {
        const data = await response.json();
        const tbody = document.getElementById('usersTableBody');
        
        if (data.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${new Date(user.created_at).toLocaleString()}</td>
            </tr>
        `).join('');
    }
}

// Create user
document.getElementById('createUserBtn').addEventListener('click', async () => {
    const username = document.getElementById('newUsername').value;
    const password = document.getElementById('newPassword').value;

    if (!username || !password) {
        showNotification('Username and password are required', true);
        return;
    }

    const response = await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    });

    if (response) {
        const data = await response.json();
        if (data.success) {
            showNotification('User created successfully!');
            document.getElementById('newUsername').value = '';
            document.getElementById('newPassword').value = '';
            loadUsers();
        } else {
            showNotification(data.error || 'Failed to create user', true);
        }
    }
});

// Cookies
let editingCookieId = null;

async function loadCookies() {
    const response = await apiRequest('/cookies');
    if (response) {
        const data = await response.json();
        const tbody = document.getElementById('cookiesTableBody');
        
        if (data.cookies.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9">No cookies found</td></tr>';
            return;
        }

        tbody.innerHTML = data.cookies.map(cookie => {
            const expires = cookie.expires ? new Date(cookie.expires * 1000).toLocaleString() : 'Session';
            const valueDisplay = cookie.value.length > 50 ? cookie.value.substring(0, 50) + '...' : cookie.value;
            return `
                <tr>
                    <td>${cookie.name}</td>
                    <td><code title="${cookie.value}">${valueDisplay}</code></td>
                    <td>${cookie.domain || '-'}</td>
                    <td>${cookie.path || '/'}</td>
                    <td>${expires}</td>
                    <td>${cookie.httpOnly ? '✓' : ''}</td>
                    <td>${cookie.secure ? '✓' : ''}</td>
                    <td>${cookie.sameSite || 'Lax'}</td>
                    <td>
                        <button class="btn-edit" onclick="editCookie(${JSON.stringify(cookie).replace(/"/g, '&quot;')})">Edit</button>
                        <button class="btn-delete" onclick="deleteCookieById(${cookie.id || 'null'})">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

function editCookie(cookie) {
    editingCookieId = cookie.id;
    document.getElementById('cookieFormTitle').textContent = 'Edit Cookie';
    document.getElementById('cookie-id').value = cookie.id || '';
    document.getElementById('cookie-name').value = cookie.name || '';
    document.getElementById('cookie-value').value = cookie.value || '';
    document.getElementById('cookie-domain').value = cookie.domain || '';
    document.getElementById('cookie-path').value = cookie.path || '/';
    document.getElementById('cookie-expires').value = cookie.expires || '';
    document.getElementById('cookie-httpOnly').checked = cookie.httpOnly || false;
    document.getElementById('cookie-secure').checked = cookie.secure || false;
    document.getElementById('cookie-sameSite').value = cookie.sameSite || 'Lax';
    document.getElementById('cookieForm').style.display = 'block';
}

function resetCookieForm() {
    editingCookieId = null;
    document.getElementById('cookieFormTitle').textContent = 'Add Cookie';
    document.getElementById('cookieForm').reset();
    document.getElementById('cookie-id').value = '';
    document.getElementById('cookie-path').value = '/';
    document.getElementById('cookie-sameSite').value = 'Lax';
    document.getElementById('cookieForm').style.display = 'none';
}

// Make functions global for onclick handlers
window.editCookie = editCookie;
window.deleteCookieById = async (id) => {
    if (!confirm('Are you sure you want to delete this cookie?')) return;
    
    const response = await apiRequest(`/cookies/${id}`, { method: 'DELETE' });
    if (response) {
        const data = await response.json();
        if (data.success) {
            showNotification('Cookie deleted successfully!');
            loadCookies();
        } else {
            showNotification(data.error || 'Failed to delete cookie', true);
        }
    }
};

// Add cookie button
document.getElementById('addCookieBtn').addEventListener('click', () => {
    resetCookieForm();
    document.getElementById('cookieForm').style.display = 'block';
});

// Cancel cookie form
document.getElementById('cancelCookieBtn').addEventListener('click', () => {
    resetCookieForm();
});

// Save cookie
document.getElementById('saveCookieBtn').addEventListener('click', async () => {
    const cookieData = {
        name: document.getElementById('cookie-name').value,
        value: document.getElementById('cookie-value').value,
        domain: document.getElementById('cookie-domain').value || null,
        path: document.getElementById('cookie-path').value || '/',
        expires: document.getElementById('cookie-expires').value ? parseInt(document.getElementById('cookie-expires').value) : null,
        httpOnly: document.getElementById('cookie-httpOnly').checked,
        secure: document.getElementById('cookie-secure').checked,
        sameSite: document.getElementById('cookie-sameSite').value,
    };

    if (!cookieData.name || !cookieData.value) {
        showNotification('Cookie name and value are required', true);
        return;
    }

    const cookieId = document.getElementById('cookie-id').value;
    const url = cookieId ? `/cookies/${cookieId}` : '/cookies';
    const method = cookieId ? 'PUT' : 'POST';

    const response = await apiRequest(url, {
        method: method,
        body: JSON.stringify(cookieData),
    });

    if (response) {
        const data = await response.json();
        if (data.success) {
            showNotification(`Cookie ${data.action} successfully!`);
            resetCookieForm();
            loadCookies();
        } else {
            showNotification(data.error || 'Failed to save cookie', true);
        }
    }
});

// Import cookies from JSON
document.getElementById('importCookiesBtn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const cookies = JSON.parse(text);
            
            if (!Array.isArray(cookies)) {
                showNotification('Invalid JSON format. Expected an array of cookies.', true);
                return;
            }

            const response = await apiRequest('/cookies/bulk', {
                method: 'POST',
                body: JSON.stringify({ cookies }),
            });

            if (response) {
                const data = await response.json();
                if (data.success) {
                    const successCount = data.results.filter(r => r.success).length;
                    showNotification(`Imported ${successCount} cookie(s) successfully!`);
                    loadCookies();
                } else {
                    showNotification(data.error || 'Failed to import cookies', true);
                }
            }
        } catch (error) {
            showNotification('Failed to parse JSON file: ' + error.message, true);
        }
    };
    input.click();
});

// Delete all cookies
document.getElementById('deleteAllCookiesBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL cookies? This cannot be undone.')) return;

    const response = await apiRequest('/cookies', { method: 'DELETE' });
    if (response) {
        const data = await response.json();
        if (data.success) {
            showNotification('All cookies deleted successfully!');
            loadCookies();
        } else {
            showNotification(data.error || 'Failed to delete cookies', true);
        }
    }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiRequest('/auth/logout', { method: 'POST' });
    localStorage.removeItem('adminToken');
    window.location.href = '/admin/login';
});

// Initialize
if (checkAuth()) {
    loadCurrentUser();
    loadDashboard();
}

