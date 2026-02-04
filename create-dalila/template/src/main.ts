import { createRouter } from 'dalila/router';
import { routes } from '../routes.generated.ts';
import { routeManifest } from '../routes.generated.manifest.ts';

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
