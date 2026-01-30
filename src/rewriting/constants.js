/**
 * Single source of truth for rewriting: domain lists and tag/attribute defaults.
 * Used by config.js, services/config.js, and migrate-config.js.
 */

module.exports = {
  skipRewriteDomains: [
    'consent.cookiefirst.com',
  ],

  noCredentialsDomains: [
    'app.launchdarkly.com',
    'events.launchdarkly.com',
    'c.adora-cdn.com',
    'consent.cookiefirst.com',
    'linkedin.com',
    'consent-eu.cookiefirst.com',
    'cookiefirst.com',
    'braze.com',
    'api.leonardo.ai',
    'braintreegateway.com',
    'braintree-api.com',
    'payments.braintree-api.com',
    'api.braintreegateway.com',
  ],

  noRewriteDomains: [],

  /** Domains where we only replace proxy→target in path/query (host stays external). */
  pathOnlyRewriteDomains: ['cookiefirst.com', 'linkedin.com'],

  /** Used by client for host matching (cookiefirst). */
  cookiefirstDomains: [
    'cookiefirst.com',
    'consent.cookiefirst.com',
    'consent-eu.cookiefirst.com',
  ],

  linkedinDomain: 'linkedin.com',

  additionalDomains: [],

  tagsToOverride: ['img', 'link', 'script', 'iframe'],
  attributesToOverride: ['href', 'src', 'content'],
};
