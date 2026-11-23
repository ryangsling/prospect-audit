import AppShell from './components/app-shell';
import AuditWorkspace from './workspace';

export default function Home() {
  return <AppShell page="audit"><AuditWorkspace /></AppShell>;
}
