import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function logoSource() {
  try {
    const svg = readFileSync(join(process.cwd(), 'public', 'logo.svg'));
    return 'data:image/svg+xml;base64,' + svg.toString('base64');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const logo = logoSource();

function Wave() {
  return <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}

export default function Wordmark() {
  return logo ? <span className="wordmark">
    {/* The SVG is read locally so the sign-in page can show it before authentication. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img width={108} height={28} src={logo} alt="incodet" />
  </span> : <span className="wordmark"><Wave />incodet<span className="wordmark-dot" aria-hidden="true">.</span></span>;
}
