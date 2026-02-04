import { createRouter } from 'dalila/router';
import { routes } from '../routes.generated';
import { routeManifest } from '../routes.generated.manifest';

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
