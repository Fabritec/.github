import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // exceljs and googleapis are Node-only; keep them out of the bundler so the
  // server routes require them at runtime instead.
  serverExternalPackages: ['exceljs', 'googleapis'],
  eslint: { ignoreDuringBuilds: true },

  // `src/lib` is shared between the Next app and the tsx CLI scripts, so its
  // imports carry the ESM-correct `.js` specifiers that Node requires. Webpack
  // resolves those against the real `.ts` sources.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
