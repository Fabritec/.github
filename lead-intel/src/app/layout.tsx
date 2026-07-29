import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fabritec Lead Intelligence',
  description: 'Discover, qualify, segment and export manufacturing leads.',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/leads', label: 'Leads' },
  { href: '/segments', label: 'Segments' },
  { href: '/review', label: 'Review queue' },
  { href: '/runs', label: 'Runs' },
  { href: '/campaigns', label: 'New campaign' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">Fabritec</div>
            <div className="brand-sub">Lead Intelligence</div>
            <nav className="nav">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
