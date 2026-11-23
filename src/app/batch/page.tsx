import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AppShell from '../components/app-shell';
import BatchUpload from '../batch-upload';

const sampleHref = 'data:text/csv;charset=utf-8,' + encodeURIComponent(readFileSync(join(process.cwd(), 'samples', 'leads.csv'), 'utf8'));

export default function BatchPage() {
  return (
    <AppShell page="batch">
      <header className="page-heading">
        <h1>Batch audits<span>.</span></h1>
        <p>Turn a lead list into individual reports and a single results spreadsheet.</p>
      </header>
      <BatchUpload sampleHref={sampleHref} />
    </AppShell>
  );
}
