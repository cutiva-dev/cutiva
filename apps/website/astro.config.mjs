// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import node from "@astrojs/node";

// Pages are static HTML. Only /api/waitlist runs on the server (prerender = false).
export default defineConfig({
  site: "https://cutiva.dev",
  output: "static",
  adapter: node({ mode: "standalone" }),
  integrations: [
    starlight({
      title: "Cutiva Docs",
      logo: { src: "./public/cutiva-mark.svg", alt: "Cutiva" },
      favicon: "/cutiva-mark.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/cutiva-dev/cutiva" }],
      customCss: ["./src/styles/docs.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "docs" },
            { label: "Getting started", slug: "docs/getting-started" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Project format (CPF)", slug: "docs/project-format" },
            { label: "Commands and undo", slug: "docs/commands" },
          ],
        },
      ],
    }),
  ],
});
