import { join } from 'node:path';
import {
  Document, Font, Image, Link, Page, Path, StyleSheet, Svg, Text, View, renderToBuffer,
} from '@react-pdf/renderer';
import { brand } from '../../config/brand';
import { formatMoney } from '../../config/currency';
import { scoreChecks } from '../checks/score';
import type { CheckResult } from '../checks/types';
import { readEnv } from '../env';
import { auditFixes } from '../fixes';
import { estimateRevenue } from '../revenue';
import type { PdfInput } from './input';

const rows = ['booking', 'chatbot', 'after_hours', 'mobile_speed', 'reviews'];
const root = process.cwd();
const fontDir = join(root, 'node_modules', '@fontsource', 'inter', 'files');
Font.register({
  family: 'Inter',
  fonts: [400, 600, 700].map(fontWeight => ({
    fontWeight,
    src: join(fontDir, `inter-latin-${fontWeight}-normal.woff`),
  })),
});

const muted = '#53535D';
const hairline = '#E0E0E5';
const accentInk = '#' + [1, 3, 5].map(offset =>
  Math.round(parseInt(brand.accent.slice(offset, offset + 2), 16) * 0.86).toString(16).padStart(2, '0'),
).join('');

const styles = StyleSheet.create({
  page: { padding: 35, backgroundColor: brand.bgLight, color: brand.bgDark, fontFamily: 'Inter', fontSize: 10 },
  header: { marginBottom: 13 },
  brandLine: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.7, borderBottomColor: hairline,
    paddingBottom: 9, marginBottom: 15, gap: 5 },
  logo: { width: 20, height: 20 },
  agency: { fontSize: 15, fontWeight: 700, maxLines: 1, textOverflow: 'ellipsis', flexGrow: 1 },
  date: { fontSize: 8, color: muted },
  heading: { fontSize: 10, fontWeight: 600, color: muted, marginBottom: 3 },
  business: { fontSize: 27, fontWeight: 700, maxLines: 1, textOverflow: 'ellipsis' },
  secondary: { fontSize: 9, lineHeight: 1.35, color: muted, marginTop: 3, maxLines: 1, textOverflow: 'ellipsis' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  index: { fontSize: 8, fontWeight: 700, color: accentInk },
  sectionLabel: { color: brand.bgDark, fontSize: 9, fontWeight: 700 },
  cards: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  card: { backgroundColor: brand.bgLight, borderWidth: 0.7, borderColor: hairline,
    padding: 9, borderRadius: 6, width: '67%' },
  score: { width: '31%', backgroundColor: brand.surfaceLight },
  cardLabel: { fontSize: 8, fontWeight: 600, color: muted, marginBottom: 3 },
  number: { fontSize: 17, fontWeight: 700, color: brand.bgDark, maxLines: 1, textOverflow: 'ellipsis' },
  grade: { fontSize: 8, color: muted, marginTop: 3 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 0.7,
    borderTopColor: hairline, paddingVertical: 6 },
  rowBody: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 9, fontWeight: 700, marginBottom: 2, maxLines: 1 },
  evidence: { fontSize: 8.5, color: muted, maxLines: 1, textOverflow: 'ellipsis' },
  badge: { width: 15, height: 15, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  fixes: { backgroundColor: brand.surfaceLight, borderRadius: 6, padding: 9, marginTop: 8, gap: 3 },
  fixRow: { flexDirection: 'row', gap: 7 },
  fix: { flex: 1, fontSize: 9, lineHeight: 1.32, maxLines: 2, textOverflow: 'ellipsis' },
  footer: { marginTop: 11, paddingTop: 9, borderTopColor: hairline, borderTopWidth: 0.7 },
  cta: { fontSize: 10, fontWeight: 700, marginBottom: 3, maxLines: 2, textOverflow: 'ellipsis' },
  links: { flexDirection: 'row', gap: 13, marginBottom: 5 },
  link: { color: accentInk, fontSize: 9 },
  assumptions: { fontSize: 7.5, lineHeight: 1.4, color: muted, maxLines: 3, textOverflow: 'ellipsis' },
  scanNote: { fontSize: 7.5, color: muted, marginTop: 4, maxLines: 2, textOverflow: 'ellipsis' },
});

function sectionHeading(index: string, title: string) {
  return <View style={styles.sectionHeading}><Text style={styles.index}>{index}</Text>
    <Text style={styles.sectionLabel}>{title}</Text>
  </View>;
}

const iconStyle: Record<CheckResult['status'], { bg: string; ink: string; path: string }> = {
  pass: { bg: '#DDF0E5', ink: '#176341', path: 'M3 6 L5 8 L9 3' },
  fail: { bg: '#FAE4E3', ink: '#982930', path: 'M4 4 L8 8 M8 4 L4 8' },
  partial: { bg: '#FFF1D3', ink: '#8A570D', path: 'M6 3 L6 6.5 M6 8.5 L6 9' },
  not_checked: { bg: '#E9EEEC', ink: '#536760', path: 'M3.5 6 L8.5 6' },
};

function badge(status: CheckResult['status']) {
  const icon = iconStyle[status];
  return <View style={[styles.badge, { backgroundColor: icon.bg }]}>
    <Svg width={12} height={12} viewBox="0 0 12 12">
      <Path d={icon.path} stroke={icon.ink} strokeWidth={1.4} strokeLinecap="round" fill="none" />
    </Svg>
  </View>;
}

function clean(text: string, max: number) {
  const characters = [...text.replace(/—/g, '-').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()];
  return characters.length > max ? characters.slice(0, max - 1).join('') + '…' : characters.join('');
}

export function reportName(input: PdfInput) {
  return input.business.name || input.business.websiteTitle || input.business.websiteUrl || 'Business audit';
}

export function pdfFilename(input: PdfInput) {
  const slug = reportName(input).replace(/^https?:\/\//i, '').normalize('NFKD')
    .replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 74).replace(/^-+|-+$/g, '');
  return `audit-${slug || 'business'}-${input.auditedAt.slice(0, 10)}.pdf`;
}

function AuditDocument({ input, env }: { input: PdfInput; env: ReturnType<typeof readEnv> }) {
  const { business, checks, auditedAt } = input;
  const { assumptions } = input.revenue;
  const score = scoreChecks(checks);
  const estimate = estimateRevenue(assumptions, checks, business.country);
  const fixes = auditFixes(checks);
  const money = (amount: number) => formatMoney(amount, business.country);
  const percent = (value: number) => new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 }).format(value);
  const date = new Intl.DateTimeFormat(business.country === 'US' ? 'en-US' : 'en-GB', {
    dateStyle: 'medium', timeZone: 'UTC',
  }).format(new Date(auditedAt));
  const size = business.country === 'UK' || business.country === 'AU' ? 'A4' : 'LETTER';

  return (
    <Document title="Online Presence Audit" author={clean(env.AGENCY_NAME, 60)}>
      <Page size={size} style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandLine}>
            {/* The local PNG avoids a network request during PDF generation. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image style={styles.logo} src={join(root, 'public', 'logo.png')} />
            <Text style={styles.agency}>{clean(env.AGENCY_NAME.toLowerCase(), 60)}</Text>
            <Text style={styles.date}>{date}</Text>
          </View>
          <Text style={styles.heading}>Online Presence Audit</Text>
          <Text style={styles.business}>{clean(reportName(input), 75)}</Text>
          {business.address && <Text style={styles.secondary}>{clean(business.address, 120)}</Text>}
          {business.firstName && <Text style={styles.secondary}>Prepared for {clean(business.firstName, 48)}</Text>}
        </View>

        {sectionHeading('/01', 'Overview')}
        <View style={styles.cards}>
          <View style={[styles.card, styles.score]}>
            <Text style={styles.cardLabel}>Online presence score</Text>
            <Text style={styles.number}>{score ? `${score.value} / 100` : 'Unavailable'}</Text>
            {score && <Text style={styles.grade}>{score.grade}</Text>}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Estimated revenue at risk</Text>
            <Text style={styles.number}>{estimate.range
              ? `${money(estimate.range.low)} to ${money(estimate.range.high)}` : 'Unavailable'}</Text>
            {estimate.range && <Text style={styles.grade}>per month</Text>}
          </View>
        </View>

        {sectionHeading('/02', 'Checks')}
        {rows.map(id => {
          const check = checks.find(item => item.id === id);
          if (!check) return null;
          return <View key={id} style={styles.row}>
            {badge(check.status)}
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{clean(check.label, 65)}</Text>
              <Text style={styles.evidence}>{clean(check.evidence, 140)}</Text>
            </View>
          </View>;
        })}

        {fixes.length > 0 && <View style={styles.fixes}>
          {sectionHeading('/03', 'Top fixes')}
          {fixes.map((fix, index) => <View key={fix} style={styles.fixRow}>
            <Text style={styles.index}>/0{index + 1}</Text><Text style={styles.fix}>{clean(fix, 130)}</Text>
          </View>)}
        </View>}

        <View style={styles.footer}>
          <Text style={styles.cta}>Want this fixed? Reply to this email{env.AGENCY_WHATSAPP ? ' or message us on WhatsApp.' : '.'}</Text>
          <View style={styles.links}>
            <Link style={styles.link} src={env.AGENCY_URL}>Agency website</Link>
            {env.AGENCY_WHATSAPP && <Link style={styles.link} src={`https://wa.me/${env.AGENCY_WHATSAPP}`}>WhatsApp</Link>}
            {env.AGENCY_EMAIL && <Link style={styles.link} src={`mailto:${env.AGENCY_EMAIL}`}>Email</Link>}
          </View>
          <Text style={styles.assumptions}>
            Assumptions: {assumptions.inquiriesPerMonth} inquiries/month, {money(assumptions.averageTicket)} average sale, {percent(assumptions.closeRate)} close rate,
            {' '}{percent(assumptions.afterHoursShare)} after-hours share, {percent(assumptions.afterHoursCapture)} captured after hours,
            {' '}{percent(assumptions.speedLossRate)} mobile speed loss, {percent(assumptions.bookingDropRate)} booking loss.
          </Text>
          <Text style={styles.scanNote}>Automated scan on {date}. Some widgets may not be detected.</Text>
        </View>
      </Page>
    </Document>
  );
}

export function renderAuditPdf(input: PdfInput, env = readEnv()) {
  return renderToBuffer(<AuditDocument input={input} env={env} />);
}
