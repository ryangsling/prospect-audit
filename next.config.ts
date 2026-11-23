import type { NextConfig } from 'next';

const pdfAssets = ['./public/logo.png', './node_modules/@fontsource/inter/files/inter-latin-*-normal.woff'];
const config: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  outputFileTracingIncludes: {
    '/api/audit/pdf': pdfAssets,
    '/api/audit/batch': pdfAssets,
  },
};

export default config;
