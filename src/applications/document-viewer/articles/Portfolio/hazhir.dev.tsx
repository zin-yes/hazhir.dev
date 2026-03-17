export default function HazhirDevDocument() {
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
      @media (max-width: 600px) {
        .page { padding: 24px 16px; }
        .title { font-size: 22px; }
      }
    </style>
  </head>

  <body>
    <main class="page">

      <h1 class="title">hazhir.dev</h1>
      <p class="subtitle">A browser desktop I built for my portfolio</p>

      <div class="divider"></div>

      <p>
        I saw <a href="https://dustinbrett.com/">Dustin Brett's website</a> in mid-2024.
        His portfolio looks like a Windows desktop. It stuck with me, and I wanted to try building something similar.
      </p>

      <p>
        I didn't want to copy Windows exactly though. The idea was just to make something that feels like a small desktop environment running in the browser.
      </p>

      <p>
        So on April 10th, 2024 I ran <code>create-next-app</code> and started building.
      </p>

      <img src="/articles/hd_desktop.png" alt="The hazhir.dev desktop environment in the browser" class="screenshot" loading="lazy" decoding="async" width="1920" height="1080" />
      <p class="caption">The full desktop environment running in the browser.</p>

      <div class="section-label">Terminal</div>
      <div class="divider"></div>

      <p>
        The first app I added was a terminal. It uses xterm.js for rendering, but all the shell logic underneath is custom: command history, tab completion, aliases, and a small set of built in commands. History gets saved to the virtual file system so it carries over between sessions.
      </p>

      <img src="/articles/hd_terminal.png" alt="The custom terminal running in the browser desktop" class="screenshot" loading="lazy" decoding="async" width="800" height="500" />
      <p class="caption">The terminal with custom shell, command history, and tab completion.</p>

      <div class="section-label">Voxel game</div>
      <div class="divider"></div>

      <p>
        After the terminal I started experimenting with a voxel game in the browser. It runs on Three.js with <strong>procedurally generated terrain</strong>, and over time I kept layering things on: chunk loading, lighting, block placement, water behavior, and eventually a basic <strong>multiplayer mode over WebRTC</strong>.
      </p>

      <img src="/articles/hd_voxel_game.png" alt="A voxel game running inside the browser desktop" class="screenshot" loading="lazy" decoding="async" width="1920" height="1080" />
      <p class="caption">A small voxel sandbox running in the browser.</p>

      <div class="section-label">Window system & desktop</div>
      <div class="divider"></div>

      <p>
        The window manager is what everything else sits on top of. Windows are draggable, resizable from any edge or corner, and support focus ordering, minimize, and close. All the apps just render inside them.
      </p>

      <p>
        There's a simple virtual file system stored in <code>localStorage</code>.
        Desktop icons come from <code>~/Desktop</code>, and apps open files through that.
        The desktop also has a top bar with an app launcher, a clock, and a user menu.
      </p>

      <div class="section-label">Apps</div>
      <div class="divider"></div>

      <p>
        I added a few small apps to make the environment feel complete: a file explorer, a text editor, a document viewer for my CV, a calculator, an image viewer, and a small breathing timer.
      </p>

      <p>
        They all run inside the same window system and share the virtual file system. The project is around 140 commits in now, and I still mostly treat it as a playground, adding things whenever I feel like it.
      </p>

      <div class="section-label">Tech</div>
      <div class="divider"></div>

      <p>
        <span class="tag">Next.js</span>
        <span class="tag">TypeScript</span>
        <span class="tag">TailwindCSS</span>
        <span class="tag">Three.js</span>
        <span class="tag">xterm.js</span>
        <span class="tag">PeerJS</span>
        <span class="tag">Web Workers</span>
        <span class="tag">GLSL</span>
        <span class="tag">Web Audio API</span>
        <span class="tag">Drizzle ORM</span>
        <span class="tag">Auth.js</span>
      </p>

      <div class="divider"></div>

      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
        <a href="https://hazhir.dev">hazhir.dev</a> ·
        <a href="https://github.com/zin-yes/hazhir.dev">GitHub</a>
      </p>

    </main>
  </body>
</html>`;
}
