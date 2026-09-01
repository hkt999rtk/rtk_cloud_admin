import { defineConfig } from '@playwright/test';
import standard from './playwright.config.mjs';

// These specs own worker-scoped Go BFFs on dynamic ports. The ordinary full
// suite still discovers them; isolated revalidation needs no shared port 18082.
export default defineConfig({
  ...standard,
  testMatch: ['scoped-products.spec.mjs', 'product-devices.spec.mjs', 'sharing-products.spec.mjs'],
  webServer: undefined,
});
