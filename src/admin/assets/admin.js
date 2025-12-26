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
        history: 'History',
        users: 'Users',
    };
    document.getElementById('pageTitle').textContent = titles[viewName];

    // Load view data
    if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'config') {
        loadConfig();
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

