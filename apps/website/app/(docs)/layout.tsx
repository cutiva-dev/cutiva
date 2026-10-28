import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { repo } from "@/lib/site";
import "./docs.css";

export const metadata: Metadata = {
  title: { template: "%s · Cutiva Docs", default: "Cutiva Docs" },
  icons: "/cutiva-mark.svg",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ defaultTheme: "dark" }}>
          <DocsLayout
            tree={source.getPageTree()}
            githubUrl={repo}
            nav={{
              title: (
                <>
                  <img src="/cutiva-mark.svg" alt="" width={24} height={24} />
                  <span className="font-semibold">cutiva</span>
                </>
              ),
            }}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}
