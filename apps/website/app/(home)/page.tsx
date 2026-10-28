import { repo } from "@/lib/site";
import { WaitlistForm } from "./waitlist-form";

const platforms = [
  { pkg: "@cutiva/react", name: "React web", text: "WebCodecs and Mediabunny decode and export MP4 in the browser. Hooks plus a drop-in timeline.", tags: ["Pilot · first", "WebCodecs"] },
  { pkg: "@cutiva/react-native", name: "React Native", text: "The same TypeScript core on a native engine built with AVFoundation and Media3, shipped as an Expo Module.", tags: ["Pilot", "Expo Module"] },
  { pkg: "cutiva_flutter", name: "Flutter", text: "A federated plugin over the same native engine, with the same API shape in Dart for iOS and Android.", tags: ["Pilot", "pub.dev"] },
];
const faq = [
  ["Can I use Cutiva today?", "Not in production yet. The core works and is tested; the browser engine is being verified. Join the waitlist or watch the repo to know when v0.1 lands."],
  ["Is it really free?", "Yes. The SDK, the editor components and local export are open source under Apache-2.0. Only the optional cloud features will be paid."],
  ["Do I need a server to export video?", "No. Export runs on the user's device with the hardware encoders of the browser or operating system."],
  ["Which platforms are supported?", "The pilot covers React web, React Native and Flutter. Native Swift and Kotlin SDKs and desktop come later, on the public roadmap."],
  ["How can I contribute?", "Star and watch the repo. Issues labelled good first issue open as the core settles. Read CONTRIBUTING.md before your first pull request."],
];

export default function Home() {
  return (
    <>
      <header className="nav">
        <nav className="wrap nav__inner" aria-label="Main">
          <a href="/" className="logo"><img src="/cutiva-mark.svg" alt="" width="30" height="30" />cutiva</a>
          <div className="nav__links">
            <a href="#platforms">Platforms</a>
            <a href="#how">How it works</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#faq">FAQ</a>
            <a href="/docs">Docs</a>
          </div>
          <div className="nav__cta">
            <a className="btn btn--sm" href={repo}>GitHub</a>
            <a className="btn btn--sm btn--primary" href="#waitlist">Get early access</a>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero__inner">
            <p className="pill"><span className="dot"></span>Open source · Apache-2.0 · In early development</p>
            <h1>Add video editing to any app you build.</h1>
            <p className="lead">The open-source video editing SDK for React, React Native and Flutter. Trim, split, add audio and export MP4 right on the device.</p>
            <div className="row">
              <a className="btn btn--primary" href="#waitlist">Get early access</a>
              <a className="btn" href={repo}>Follow on GitHub</a>
            </div>
            <div className="window" role="img" aria-label="Cutiva code beside a video preview and a timeline with video and audio clips">
              <div className="window__bar"><i></i><i></i><i></i><span>editor.ts</span></div>
              <div className="window__body">
                <pre className="code"><code><span className="k">import</span> {"{ createEditor }"} <span className="k">from</span> <span className="s">"@cutiva/core"</span>;{`

`}<span className="k">const</span> editor = createEditor();{`
editor.dispatch({
  type: `}<span className="s">"clip.split"</span>{`,
  clipId,
  atUs: `}<span className="n">12_000_000</span>{`,
});
editor.undo();

`}<span className="k">await</span>{` engine.export({
  container: `}<span className="s">"mp4"</span>{`,
  resolution: `}<span className="s">"1080p"</span>{`,
}).done;`}</code></pre>
                <div className="mock" aria-hidden="true">
                  <div className="mock__screen">
                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#edeef0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M10 8l6 4-6 4z"></path></svg>
                  </div>
                  <div className="mock__meta"><span>00:00:12.040</span><span>1080p · 30 fps</span></div>
                  <div className="tracks">
                    <div className="lane"><b style={{ flex: 30 }}></b><b style={{ flex: 18 }}></b><b style={{ flex: 44 }}></b></div>
                    <div className="lane lane--thin"><b className="gap" style={{ flex: 12 }}></b><b style={{ flex: 24 }}></b><b className="gap" style={{ flex: 56 }}></b></div>
                    <div className="lane lane--audio"><b style={{ flex: 60 }}></b><b style={{ flex: 34 }}></b></div>
                    <div className="playhead"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="strip" aria-label="Frameworks">
          <div className="wrap strip__inner">
            <span className="muted">Built for</span>
            <strong>React</strong><strong>React Native</strong><strong>Flutter</strong>
            <strong className="muted">Next.js</strong><strong className="muted">Expo</strong>
          </div>
        </section>

        <section id="platforms" className="section">
          <div className="wrap">
            <div className="head">
              <h2>One toolkit for building video editors</h2>
              <p className="lead">One project format and one command model. Each platform renders with its own native media engine.</p>
            </div>
            <div className="grid">
              {platforms.map((p) => (
                <article className="card" key={p.pkg}>
                  <p className="mono muted">{p.pkg}</p>
                  <h3>{p.name}</h3>
                  <p>{p.text}</p>
                  <div className="tags">{p.tags.map((t, i) => <span key={t} className={i === 0 ? "tag tag--cut" : "tag"}>{t}</span>)}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--band">
          <div className="wrap">
            <div className="head"><h2>Ship video features in days, not months</h2></div>
            <div className="grid">
              <article className="card card--wide">
                <div>
                  <h3>Edits stay on the device</h3>
                  <p className="muted">Preview and export run on the device&apos;s hardware encoders. No render servers to pay for, and your users&apos; videos never leave their phone or browser.</p>
                </div>
                <div className="tags"><span className="chip">WebCodecs</span><span className="chip">AVFoundation</span><span className="chip">VideoToolbox</span><span className="chip">Media3</span><span className="chip">MediaCodec</span></div>
              </article>
              <article className="card"><h3>One portable project format</h3><p>A versioned JSON schema with integer timings. Save on the web, open in React Native or Flutter.</p></article>
              <article className="card"><h3>Undo and redo, built in</h3><p>Every edit is a command the core validates and records. Nothing is ever left half applied.</p></article>
              <article className="card"><h3>Headless or drop-in UI</h3><p>Use the timeline component, or build your own interface on the core.</p></article>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="wrap">
            <div className="head"><h2>Import, edit, export</h2></div>
            <ol className="steps">
              <li><h3>Import</h3><p>Load local video and audio. Cutiva reads duration and codecs, and fingerprints each file so projects relink anywhere.</p><code>engine.importFile(file)</code></li>
              <li><h3>Edit</h3><p>Trim, split, reorder and mix audio with commands, from your UI, from ours, or from code.</p><code>editor.dispatch(command)</code></li>
              <li><h3>Export</h3><p>Render an MP4 on the device with progress and cancel, or save the project as JSON to keep editing later.</p><code>{'engine.export({ container: "mp4" })'}</code></li>
            </ol>
          </div>
        </section>

        <section className="section section--band">
          <div className="wrap offer">
            <div className="card">
              <span className="tag tag--track" style={{ alignSelf: "flex-start" }}>Free forever</span>
              <h2>Open source SDK</h2>
              <p>Everything you need to edit locally, under Apache-2.0. The cloud is never required.</p>
              <ul><li>Core SDK and project format</li><li>Timeline, trim, split and audio</li><li>UI components and local MP4 export</li><li>Docs and examples</li></ul>
            </div>
            <div id="waitlist" className="card card--accent">
              <span className="tag tag--cut" style={{ alignSelf: "flex-start" }}>Planned</span>
              <h2>Cutiva Cloud</h2>
              <p>Optional AI automation that returns edits you can review, change and undo, not a finished video you can&apos;t touch.</p>
              <ul><li>Silence removal and automatic subtitles</li><li>Reframing from 16:9 to 9:16</li><li>Highlights, cloud rendering and batch jobs</li></ul>
              <WaitlistForm />
            </div>
          </div>
        </section>

        <section id="roadmap" className="section">
          <div className="wrap">
            <div className="head">
              <h2>Built in the open</h2>
              <p className="lead">Each phase opens only when the one before passes its gate. Nothing is marked done until it ships.</p>
            </div>
            <ol className="roadmap">
              <li className="now"><span>Phase 0 · now</span><strong>Foundations</strong><small>Core, CI and an in-browser export spike</small></li>
              <li><span>Phase 1</span><strong>Web pilot</strong><small>React SDK, online playground, npm v0.1</small></li>
              <li><span>Phase 2</span><strong>Mobile pilot</strong><small>React Native and Flutter on one native engine</small></li>
              <li><span>Phase 3</span><strong>Full web editing</strong><small>Firefox, Safari, text, transitions</small></li>
              <li><span>Phase 4–5</span><strong>Native, desktop, cloud</strong><small>Swift, Kotlin, desktop and Cutiva Cloud</small></li>
            </ol>
          </div>
        </section>

        <section id="faq" className="section section--band">
          <div className="wrap faq">
            <div className="head"><h2>Frequently asked questions</h2></div>
            {faq.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="wrap final">
            <img src="/cutiva-mark.svg" alt="" width="64" height="64" />
            <h2>Start building with Cutiva</h2>
            <p className="lead">Follow the build, try the first release and help shape the API.</p>
            <div className="row">
              <a className="btn btn--primary" href="#waitlist">Get early access</a>
              <a className="btn" href="/docs">Read the docs</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer__cols">
          <div>
            <a href="/" className="logo"><img src="/cutiva-mark.svg" alt="" width="28" height="28" />cutiva</a>
            <p className="muted" style={{ margin: 0 }}>The open-source video editing SDK for every platform.</p>
          </div>
          <div><strong>Product</strong><a href="#platforms">Platforms</a><a href="#roadmap">Roadmap</a><a href="#waitlist">Cutiva Cloud</a></div>
          <div><strong>Resources</strong><a href="/docs">Docs</a><a href="/docs/getting-started">Getting started</a><a href={`${repo}/blob/main/CONTRIBUTING.md`}>Contributing</a></div>
          <div><strong>Community</strong><a href={repo}>GitHub</a></div>
        </div>
        <div className="wrap footer__bottom"><span>© 2026 Cutiva · Apache-2.0</span><span className="mono">cutiva.dev</span></div>
      </footer>
    </>
  );
}
