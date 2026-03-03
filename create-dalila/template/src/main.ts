import DOMPurify from 'dompurify';
import { configure } from 'dalila/runtime';
import { createRouter } from 'dalila/router';
import { routes } from '../routes.generated.js';
import { routeManifest } from '../routes.generated.manifest.js';

configure({
  sanitizeHtml: (html) => DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
    FORBID_ATTR: ['srcdoc'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    RETURN_TRUSTED_TYPE: false,
  }),
  security: {
    strict: true,
    trustedTypes: true,
    trustedTypesPolicyName: '__DALILA_TRUSTED_TYPES_POLICY__',
  },
});

const outlet = document.getElementById('app');

if (!outlet) {
  throw new Error('Missing #app element');
}

const router = createRouter({
  outlet,
  routes,
  routeManifest
});

router.start();
