import { repo } from "@/lib/site";

export function SiteNav() {
  return (
    <header className="nav">
      <nav className="wrap nav__inner" aria-label="Main">
        <a href="/" className="logo"><img src="/cutiva-mark.svg" alt="" width="30" height="30" />cutiva</a>
        <div className="nav__links">
          <a href="/#platforms">Platforms</a>
          <a href="/#how">How it works</a>
          <a href="/#roadmap">Roadmap</a>
          <a href="/#faq">FAQ</a>
          <a href="/play">Playground</a>
          <a href="/docs">Docs</a>
          <a href="/about">About</a>
        </div>
        <div className="nav__cta">
          <a className="btn btn--sm" href={repo}>GitHub</a>
          <a className="btn btn--sm btn--primary" href="/#waitlist">Get early access</a>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap footer__cols">
        <div>
          <a href="/" className="logo"><img src="/cutiva-mark.svg" alt="" width="28" height="28" />cutiva</a>
          <p className="muted" style={{ margin: 0 }}>The open-source video editing SDK for every platform.</p>
        </div>
        <div><strong>Product</strong><a href="/#platforms">Platforms</a><a href="/#roadmap">Roadmap</a><a href="/#waitlist">Cutiva Cloud</a></div>
        <div><strong>Resources</strong><a href="/play">Playground</a><a href="/docs">Docs</a><a href="/docs/getting-started">Getting started</a><a href={`${repo}/blob/main/CONTRIBUTING.md`}>Contributing</a></div>
        <div><strong>Company</strong><a href="/about">About</a><a href={repo}>GitHub</a></div>
      </div>
      <div className="wrap footer__bottom"><span>© 2026 Cutiva · Apache-2.0</span><span className="mono">cutiva.dev</span></div>
    </footer>
  );
}
