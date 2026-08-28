import { access, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve(import.meta.dirname, '../../docs/rtk_cloud_contracts_doc/fixtures/chipset-sdk-provider');
const destination = resolve(import.meta.dirname, '../public/assets/chipset-packages');
const files = ['realtek-amebapro2.json', 'chipset-resource-package-v1.schema.json'];

await mkdir(destination, { recursive: true });
try {
  await access(source);
  await Promise.all(files.map((file) => copyFile(resolve(source, file), resolve(destination, file))));
  console.log(`Published ${files.length} chipset resource package assets from the canonical contracts checkout.`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  await Promise.all(files.map((file) => access(resolve(destination, file))));
  console.log(`Using ${files.length} bundled chipset resource package assets.`);
}
