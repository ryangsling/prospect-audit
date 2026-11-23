import { readFileSync } from 'node:fs';

export function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
}
