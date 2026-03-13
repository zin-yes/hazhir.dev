export default function AtlasDocument() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        --fg: #0f172a;
        --muted: #475569;
        --line: #cbd5e1;
        --chip: #f1f5f9;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: var(--fg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
      .page {
        min-height: 100%;
        padding: 40px;
        max-width: 720px;
        margin: 0 auto;
      }
      .title {
        margin: 0;
        font-size: 26px;
        font-weight: 800;
        letter-spacing: 0.01em;
      }
      .subtitle {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .divider {
        margin: 20px 0;
        width: 100%;
        height: 1px;
        background: var(--line);
      }
      p, li {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.72;
        letter-spacing: 0.01em;
        margin: 0 0 14px;
      }
      .section-label {
        margin: 28px 0 4px;
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .caption {
        text-align: center;
        color: #94a3b8;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        margin: -4px 0 22px;
      }
      .screenshot {
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--line);
        margin: 16px 0;
        display: block;
      }
      .commit-timeline {
        margin: 16px 0 20px;
        padding: 0;
        list-style: none;
        border-left: 2px solid var(--line);
        padding-left: 16px;
      }
      .commit-timeline li {
        position: relative;
        margin-bottom: 10px;
        font-size: 13px;
        line-height: 1.55;
      }
      .commit-timeline li::before {
        content: "";
        position: absolute;
        left: -21px;
        top: 7px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--line);
        border: 2px solid #ffffff;
      }
      .commit-timeline li strong {
        color: var(--fg);
        font-weight: 700;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        border-radius: 9999px;
        background: var(--chip);
        color: #334155;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: 0.03em;
        white-space: nowrap;
        margin-right: 4px;
      }
      a {
        color: var(--fg);
        text-decoration: underline;
      }
      code {
        font-family: "Geist Mono", ui-monospace, monospace;
        font-size: 12px;
        background: var(--chip);
        padding: 1px 5px;
        border-radius: 4px;
      }
      .date-chip {
        display: inline-flex;
        align-items: center;
        border-radius: 9999px;
        background: var(--chip);
        color: #64748b;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.03em;
        margin-left: 6px;
      }
      .quote {
        border-left: 3px solid var(--line);
        margin: 16px 0 20px;
        padding: 8px 16px;
        color: #64748b;
        font-size: 13px;
        font-style: italic;
        line-height: 1.65;
      }
      @media (max-width: 600px) {
        .page { padding: 24px 16px; }
        .title { font-size: 22px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <h1 class="title">Atlas</h1>
      <p class="subtitle">An AI sales tool built during the <a href="https://www.antler.co/">Antler residency</a></p>

      <div class="divider"></div>

      <p>
        Atlas is an AI tool I built over six months with my cofounder Felix, as part of the <a href="https://www.antler.co/">Antler residency programme</a>. It was designed to help sales teams find, research, and engage with prospects. It was my first real startup experience, and it shaped how I think about building software, working with people, and what I want to do with my career.
      </p>

      <img src="/articles/atlas.png" alt="Atlas application interface" class="screenshot" loading="lazy" decoding="async" width="1920" height="1080" />
      <p class="caption">The Atlas interface.</p>

      <div class="section-label">How it started</div>
      <div class="divider"></div>

      <p>
        Felix was a friend of my friend Erik. Felix had already been building an MVP for about half a year when Erik got involved. I told Erik I wanted in. I'd been interested in startups for a while and this felt like the right opportunity. Once all three of us started working together, things moved at a much faster pace and we got more serious about it.
      </p>

      <div class="section-label">The Antler experience</div>
      <div class="divider"></div>

      <p>
        Being surrounded by such passionate and focused people every day was an incredible high. The environment was motivating in a way I hadn't experienced before. For the first time I felt like I was around people who thought the same way I did, people who just got it. That was really validating.
      </p>

      <p>
        Erik ended up leaving later down the line, and it was just Felix and me from that point. The two of us kept pushing.
      </p>

      <div class="section-label">Keeping it going</div>
      <div class="divider"></div>

      <p>
        The hardest part wasn't technical, it was financial. Both Felix and I nearly went personally bankrupt. We had to pick up part time work to stay afloat while the product wasn't generating enough revenue yet. We were both in a tight spot financially, but we made it work. Felix did sales, I fixed bugs and shipped features, every spare hour went into Atlas.
      </p>

      <div class="section-label">What we built</div>
      <div class="divider"></div>

      <p>
        The product brought together live web search, company and contact enrichment, conversational AI, voice transcription, and a credits based billing system into a single interface. It was essentially a research assistant built into a team's sales pipeline. We reached around 30k SEK in monthly recurring revenue and closed customers like Scrive.
      </p>

      <p>
        While I can't discuss specific product details due to an NDA, the architecture was something I'm proud of. The codebase grew to around <strong>160k lines of code</strong>, and we adopted a strict <strong>Repository-Service-Router</strong> pattern that kept it all navigable. Every feature followed the same convention: repositories touched the database, services handled logic, routers validated input and delegated. No exceptions.
      </p>

      <div class="section-label">Moving on</div>
      <div class="divider"></div>

      <p>
        I moved on from Atlas in December 2025. The reasons were complex and personal. It was a difficult decision, but it was the right one for me at the time. Despite how it ended, I have no regrets about the experience.
      </p>

      <div class="section-label">What I took away</div>
      <div class="divider"></div>

      <p>
        I've always known that I wanted to build companies. I believe a company is the most efficient way to organize people and resources toward something good. After Antler, after being surrounded by people who shared that same drive, it validated something I'd felt for a long time. I know for sure now that building companies is what I want to do with my life.
      </p>

      <p>
        On the technical side, the biggest thing I took away was how much early architectural decisions matter. Having clear patterns that everyone follows prevents a lot of headaches and makes it much easier to move fast later on.
      </p>

      <div class="section-label">Timeline <span class="date-chip">Jun - Dec 2025</span></div>
      <div class="divider"></div>

      <ul class="commit-timeline">
        <li><strong>July 2025</strong> · Initialized the web template and got to a working MVP <strong>within two weeks</strong>.</li>
        <li><strong>August 2025</strong> · Formalized the architecture, rewrote billing and auth.</li>
        <li><strong>September 2025</strong> · Shipped AI conversations with tool use, memory, and webhook integrations.</li>
        <li><strong>October 2025</strong> · Full UI consolidation and v1 launch.</li>
      </ul>

      <div class="section-label">Stack</div>
      <div class="divider"></div>

      <p>
        <span class="tag">Next.js</span>
        <span class="tag">TypeScript</span>
        <span class="tag">tRPC</span>
        <span class="tag">Drizzle ORM</span>
        <span class="tag">PostgreSQL</span>
        <span class="tag">Vercel AI SDK</span>
        <span class="tag">TailwindCSS</span>
        <span class="tag">Bun</span>
        <span class="tag">better-auth</span>
        <span class="tag">QStash</span>
      </p>

      <div class="divider"></div>

      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
        <a href="https://useatlas.io">Atlas</a> · Built with Felix · Antler Residency · Jun to Dec 2025
      </p>
    </main>
  </body>
</html>
`;
}
