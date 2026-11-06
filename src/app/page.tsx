// Accel Business — B2B landing page for MSMEs. Accel Telecom is a fictional operator; all figures are synthetic.
// Visual system follows DESIGN.md (light canvas, single red accent, uppercase 800 display, pill CTAs).

import Link from 'next/link';
import { AccelMark } from '@/components/AccelMark';
// Route for the Accel Bot bundle-recommendation experience.
const BOT_HREF = '/bot';

const icon = {
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  clinic: 'M12 6v12M6 12h12M4 4h16v16H4z',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16M8 7h7',
  factory: 'M3 21V10l6 4V10l6 4V6h6v15zM7 17h2M12 17h2M17 17h2',
  calc: 'M6 3h12v18H6zM9 7h6M9 12h1M14 12h1M9 16h1M14 16h1',
  food: 'M5 3v8a2 2 0 002 2v8M9 3v8M7 3v8M17 3c-2 0-3 3-3 6s1 4 3 4v8',
};

function Icon({ d }: { d: string }) {
  return (
    <span className="segment-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

const segments = [
  {
    icon: icon.store,
    title: 'Kirana & retail',
    copy: 'Always-on billing and UPI, a store Wi-Fi your customers can use, and a number that never goes to voicemail.',
    chips: ['Fibre + 4G backup', 'UPI soundbox', 'WhatsApp catalogue'],
  },
  {
    icon: icon.clinic,
    title: 'Clinics & diagnostics',
    copy: 'Reliable links for e-prescriptions and lab reports, plus appointment calling that routes to whoever is free.',
    chips: ['Static IP', 'Cloud PBX', 'Secure backup'],
  },
  {
    icon: icon.book,
    title: 'Coaching centres',
    copy: 'Lag-free live classes and recordings, with managed Wi-Fi that handles a full batch logging in at once.',
    chips: ['Up to 1 Gbps', 'Managed Wi-Fi', 'Bulk SMS'],
  },
  {
    icon: icon.factory,
    title: 'Small manufacturers',
    copy: 'Connect the shop floor, the office and the delivery fleet on one network, with GPS tracking for every vehicle.',
    chips: ['Leased line', 'IoT SIMs', 'Fleet tracking'],
  },
  {
    icon: icon.calc,
    title: 'CA & professional firms',
    copy: 'Fast uploads during filing season, secure email and storage, and protection for your clients’ financial data.',
    chips: ['Business email', 'Cybersecurity', 'Cloud storage'],
  },
  {
    icon: icon.food,
    title: 'Restaurants & cafés',
    copy: 'Keep the POS, the aggregator tablets and guest Wi-Fi running through the dinner rush.',
    chips: ['Guest Wi-Fi', 'POS uptime', 'Toll-free number'],
  },
];

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <a href="#" className="brand" aria-label="Accel Business home">
            <AccelMark />
            <span className="brand-name">
              Accel
              <small>Business</small>
            </span>
          </a>

          <nav aria-label="Primary">
            <ul className="nav-links">
              <li><a href="#solutions">Solutions</a></li>
              <li><a href="#get-started">How it works</a></li>
              <li><a href="#support">Support</a></li>
            </ul>
          </nav>

          <div className="nav-actions">
            <Link href="/login" className="btn btn-outline-dark">Log in</Link>
            <Link href={BOT_HREF} className="btn btn-primary">Ask Accel Bot</Link>
            <details className="nav-menu">
              <summary aria-label="Open menu">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h14M3 10h14M3 14h14" />
                </svg>
              </summary>
              <div className="nav-menu-panel">
                <a href="#solutions">Solutions</a>
                <a href="#get-started">How it works</a>
                <a href="#support">Support</a>
                <Link href="/login">Log in</Link>
                <Link href={BOT_HREF} className="btn btn-primary">Ask Accel Bot</Link>
              </div>
            </details>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="hero" aria-labelledby="hero-title">
          <div className="container">
            <h1 id="hero-title" className="hero-title">
              Built for the business <span className="accent">next door.</span>
            </h1>

            <p className="hero-lead">
              Fibre, postpaid and Wi-Fi for India’s small businesses. Accel Bot builds the right bundle with you.
            </p>
            <div className="hero-ctas">
              <Link href={BOT_HREF} className="btn btn-primary">
                Find my bundle with Accel Bot
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <a href="#support" className="btn btn-outline-dark">Talk to an expert</a>
            </div>
          </div>
        </section>

        {/* ---------- Stats ---------- */}
        <section className="stats" aria-label="Accel at a glance">
          <div className="container stats-grid">
            <div className="stat"><strong>No.1</strong><span>mobile network in India</span></div>
            <div className="stat"><strong>Top 2</strong><span>home broadband provider</span></div>
            <div className="stat"><strong>6 Cr+</strong><span>MSMEs we’re building for</span></div>
            <div className="stat"><strong>24×7</strong><span>business support in 12 languages</span></div>
          </div>
        </section>

        {/* ---------- Segments ---------- */}
        <section id="solutions" className="band band-light" aria-labelledby="solutions-title">
          <div className="container">
            <div className="section-head">
              <div>
                <p className="eyebrow">Solutions</p>
                <h2 id="solutions-title" className="section-title">
                  Made for how your business actually runs.
                </h2>
              </div>
              <p className="section-sub">
                Big-company connectivity, without the big-company contract. Start with what you need today and add
                more as you grow.
              </p>
            </div>

            <div className="segments">
              {segments.map((s) => (
                <article key={s.title} className="segment">
                  <Icon d={s.icon} />
                  <h3>{s.title}</h3>
                  <p>{s.copy}</p>
                  <div className="chips">
                    {s.chips.map((c) => (
                      <span key={c} className="chip">{c}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section id="get-started" className="band band-light" style={{ paddingTop: 0 }} aria-labelledby="steps-title">
          <div className="container">
            <div className="section-head">
              <div>
                <p className="eyebrow">How it works</p>
                <h2 id="steps-title" className="section-title">From first chat to switched on, without the paperwork.</h2>
              </div>
            </div>

            <ol className="steps">
              <li className="step">
                <h3>Chat with Accel Bot</h3>
                <p>
                  Tell it about your business, your team and how you work. It recommends a bundle that fits, with
                  nothing you don’t need.
                </p>
              </li>
              <li className="step">
                <h3>Verify your business</h3>
                <p>
                  Upload your GST or Udyam certificate, an address proof and the signatory’s ID. We check them against
                  government registries automatically.
                </p>
                <div className="chips">
                  <span className="chip">GSTIN</span>
                  <span className="chip">Udyam</span>
                  <span className="chip">DPDP-compliant</span>
                </div>
              </li>
              <li className="step">
                <h3>Get connected</h3>
                <p>An engineer installs your fibre and router, your SIMs are activated, and you’re live in 48 hours.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <section className="band-red" aria-labelledby="cta-title">
          <div className="container cta-inner">
            <h2 id="cta-title" className="cta-title">Your business, always on.</h2>
            <div className="cta-side">
              <p>Answer a few questions and Accel Bot will put together your perfect bundle.</p>
              <Link href={BOT_HREF} className="btn btn-on-red">Find my bundle</Link>
            </div>
          </div>
        </section>
      </main>

      <footer id="support" className="footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <span className="brand">
                <AccelMark />
                <span className="brand-name">
                  Accel
                  <small>Business</small>
                </span>
              </span>
              <p className="footer-about">
                The business arm of Accel Telecom, serving everyone from large corporates to India’s neighbourhood
                businesses.
              </p>
            </div>
            <div>
              <h4>Products</h4>
              <ul>
                <li><a href="#solutions">Business fibre</a></li>
                <li><a href="#solutions">Postpaid & SIMs</a></li>
                <li><a href="#solutions">Cloud PBX</a></li>
                <li><a href="#solutions">IoT & fleet</a></li>
              </ul>
            </div>
            <div>
              <h4>Industries</h4>
              <ul>
                <li><a href="#solutions">Retail & kirana</a></li>
                <li><a href="#solutions">Healthcare</a></li>
                <li><a href="#solutions">Education</a></li>
                <li><a href="#solutions">Manufacturing</a></li>
              </ul>
            </div>
            <div>
              <h4>Support</h4>
              <ul>
                <li><Link href={BOT_HREF}>Accel Bot</Link></li>
                <li><a href="tel:121">Call 121 (24×7)</a></li>
                <li><a href="#get-started">KYC help</a></li>
                <li><a href="#support">Privacy & DPDP</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 Accel Business, a division of Accel Telecom.</span>
            <span>Fictional operator built for the Airtel Sync 2026 case. All figures and data are synthetic.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
