import type { Metadata } from "next";
import { repo } from "@/lib/site";
import { SiteFooter, SiteNav } from "../chrome";

export const metadata: Metadata = {
  title: "About — Cutiva",
  description: "Why Cutiva exists, the principles behind it and the people building it.",
};

const principles = [
  { title: "Open source by default", text: "The SDK, the editor components and local export are Apache-2.0. The cloud is optional and never required." },
  { title: "Edits stay on the device", text: "Preview and export use the hardware encoders of the browser or operating system. No render servers, no uploads." },
  { title: "One core, every platform", text: "One project format and one set of edit rules. Every SDK passes the same conformance fixtures." },
  { title: "Honest status", text: "Nothing is called working until a test proves it. Untested features say so." },
];

const founder = { name: "Wilfredo Noyola", role: "Founder", initials: "WN", github: "https://github.com/wilfredonoyola" };

const resources = [
  { title: "Docs", text: "Getting started, the API and the project format.", href: "/docs" },
  { title: "Playground", text: "Try the editor in your browser.", href: "/play" },
  { title: "GitHub", text: "Source, issues and the roadmap.", href: repo },
  { title: "Contributing", text: "How to send your first pull request.", href: `${repo}/blob/main/CONTRIBUTING.md` },
];

export default function About() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="hero">
          <div className="wrap hero__inner hero__inner--short">
            <p className="pill"><span className="dot"></span>About Cutiva</p>
            <h1>Video editing should be a feature, not a project.</h1>
            <p className="lead">Wilfredo Noyola started Cutiva in 2026 so any developer can add trimming, splitting, audio and MP4 export to their app without building a media engine first.</p>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="head">
              <p className="eyebrow">Our mission</p>
              <h2>Make video editing a standard building block for every app.</h2>
              <p className="lead">Today, adding an editor means months of work on codecs, timelines and sync, or a closed SDK priced per seat. Cutiva gives you an open toolkit for React, React Native and Flutter instead.</p>
            </div>
            <div className="grid grid--four">
              {principles.map((p) => (
                <article className="card" key={p.title}><h3>{p.title}</h3><p>{p.text}</p></article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section--band">
          <div className="wrap">
            <div className="head"><h2>Why I&apos;m building Cutiva</h2></div>
            <div className="founder">
              <article className="card person">
                <div className="avatar" aria-hidden="true">{founder.initials}</div>
                <h3>{founder.name}</h3>
                <p>{founder.role}</p>
                <a href={founder.github} aria-label={`${founder.name} on GitHub`}>GitHub</a>
              </article>
              <div className="story">
                <p>I&apos;m a full-stack developer, and much of my work has been heavy video: streaming, processing and editing. Project after project I hit the same wall. Every app that needed a simple editor meant choosing between months of work on codecs, timelines and audio sync, or a closed SDK priced per seat with limits on what you can export.</p>
                <p>I want a different option to exist: a free and open ecosystem where any developer gets video editing tools with no limits, for the platforms people build with most. One project format, the same edit rules everywhere, and export that runs on the user&apos;s own device.</p>
                <p>That is Cutiva. It&apos;s early, it&apos;s built in the open, and every issue and pull request helps shape it. The SDK will always be free; Cutiva Cloud is how the project pays for itself. <a href={`${repo}/blob/main/CONTRIBUTING.md`}>Come build it with me.</a></p>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="head">
              <h2>Free SDK, optional cloud</h2>
              <p className="lead">Everything you need to edit and export on the device stays open source, with no limits. If you want to automate editing, Cutiva Cloud will add AI on top. The cloud is never required.</p>
            </div>
            <div className="offer">
              <div className="card">
                <span className="tag tag--track" style={{ alignSelf: "flex-start" }}>Free forever</span>
                <h2>Open source SDK</h2>
                <p>Apache-2.0. Edit and export MP4 on the user&apos;s device, with no render servers and no usage limits.</p>
                <ul><li>Core SDK and project format</li><li>Timeline, trim, split and audio</li><li>UI components and local MP4 export</li></ul>
              </div>
              <div className="card card--accent">
                <span className="tag tag--cut" style={{ alignSelf: "flex-start" }}>Planned</span>
                <h2>Cutiva Cloud</h2>
                <p>AI automation that returns edits you can review, change and undo, not a finished video you can&apos;t touch.</p>
                <ul><li>Silence removal and automatic subtitles</li><li>Reframing from 16:9 to 9:16</li><li>Highlights, cloud rendering and batch jobs</li></ul>
                <a className="btn btn--primary" href="/#waitlist" style={{ alignSelf: "flex-start", marginTop: 8 }}>Join the waitlist</a>
              </div>
            </div>
          </div>
        </section>

        <section className="section section--band">
          <div className="wrap">
            <div className="head"><h2>Learn more about Cutiva</h2></div>
            <div className="grid grid--four">
              {resources.map((r) => (
                <a className="card card--link" href={r.href} key={r.title}><h3>{r.title}</h3><p>{r.text}</p></a>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap final">
            <img src="/cutiva-mark.svg" alt="" width="64" height="64" />
            <h2>Start building with Cutiva</h2>
            <p className="lead">Follow the build, try the first release and help shape the API.</p>
            <div className="row">
              <a className="btn btn--primary" href="/#waitlist">Get early access</a>
              <a className="btn" href="/docs">Read the docs</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
