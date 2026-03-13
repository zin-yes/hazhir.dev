export default function MetricJournalDocument() {
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
      .screenshot {
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--line);
        margin: 16px 0;
        display: block;
      }
      .caption {
        text-align: center;
        color: #94a3b8;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        margin: -8px 0 20px;
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
      @media (max-width: 600px) {
        .page { padding: 24px 16px; }
        .title { font-size: 22px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <h1 class="title">MetricJournal</h1>
      <p class="subtitle">A small app I built to log what I do during the day</p>

      <div class="divider"></div>

      <p>
        Early 2025 my therapist told me to log everything I did during the day. Every event, task, break, and meal. I tried it for a week and it actually helped. Seeing the day laid out like that made me more aware of how I spend my time.
      </p>

      <p>
        Pen and paper got annoying pretty quickly though. I wanted something I could open on my phone or laptop, log something in a couple seconds, and move on. None of the apps I tried worked the way I wanted, so I built a small one.
      </p>

      <div class="section-label">First version</div>
      <div class="divider"></div>

      <p>
        The first version was very simple: a timeline for the day and a box to add entries. I built it in a day and started using it. I kept adding things when I ran into something missing.
      </p>

      <img src="/articles/mj_first_version.png" alt="The first version of MetricJournal showing a simple timeline" class="screenshot" loading="lazy" decoding="async" width="800" height="600" />
      <p class="caption">The first version. Just a timeline and an "add entry" button.</p>

      <div class="section-label">Journaling & timeline</div>
      <div class="divider"></div>

      <p>
        The core of the app is still the daily timeline. You log what you're doing, and everything shows up chronologically. It's the first thing you see when you open the app, and it's intentionally minimal so logging takes seconds, not minutes.
      </p>

      <div class="section-label">Backlog</div>
      <div class="divider"></div>

      <p>
        Over time I realized I also needed somewhere to dump tasks and ideas that I didn't want to forget but wasn't ready to act on yet. The backlog is a simple task list that lives alongside the timeline. Things move from backlog to timeline when I start working on them.
      </p>

      <img src="/articles/mj_backlog_page.png" alt="MetricJournal backlog page with task management" class="screenshot" loading="lazy" decoding="async" width="800" height="600" />
      <p class="caption">The backlog page for managing tasks and ideas.</p>

      <div class="section-label">Tracking</div>
      <div class="divider"></div>

      <p>
        After using it for a while I wanted to track habits and recurring activities. The tracking section shows an activity heatmap and lets you mark off daily habits. It ties into the timeline so everything stays connected.
      </p>

      <img src="/articles/mj_tracking_page.png" alt="MetricJournal tracking page with habit heatmap" class="screenshot" loading="lazy" decoding="async" width="800" height="600" />
      <p class="caption">Habit tracking with a heatmap view.</p>

      <div class="section-label">Profile</div>
      <div class="divider"></div>

      <p>
        I added some simple social features so friends can react or comment on logged events. The profile page is where you see your activity summary and where others can see what you've been up to.
      </p>

      <img src="/articles/mj_profile_page.png" alt="MetricJournal profile page" class="screenshot" loading="lazy" decoding="async" width="800" height="600" />
      <p class="caption">The profile page with activity summary.</p>

      
      <p>
        At this point it's around <strong>180 commits</strong>. The main idea is still the same: log what you do, see your days more clearly, and hopefully make slightly better decisions about how you spend your time.
      </p>

      <div class="section-label">Tech</div>
      <div class="divider"></div>

      <p>
        <span class="tag">Nx</span>
        <span class="tag">Next.js</span>
        <span class="tag">TypeScript</span>
        <span class="tag">TailwindCSS</span>
        <span class="tag">Drizzle ORM</span>
        <span class="tag">SQLite</span>
        <span class="tag">tRPC</span>
        <span class="tag">better-auth</span>
        <span class="tag">Stripe</span>
      </p>

      <div class="divider"></div>

      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
        <a href="https://metricjournal.com">metricjournal.com</a> · <a href="https://github.com/zin-yes/metricjournal">GitHub</a>
      </p>
    </main>
  </body>
</html>`;
}
