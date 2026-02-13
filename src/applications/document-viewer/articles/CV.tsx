type CVLink = {
  label: string;
  href: string;
};

type ExperienceEntry = {
  title: string;
  meta?: string;
  links?: readonly CVLink[];
  bullets: readonly string[];
};

type ProjectEntry = {
  title: string;
  links?: readonly CVLink[];
  paragraphs: readonly string[];
};

type EducationEntry = {
  school: string;
  program: string;
};

type LanguageEntry = {
  name: string;
  level: string;
};

const cvData = {
  name: "HAZHIR TAHER",
  location: "Norrköping, Sweden",
  phone: "+46 72 84-311 37",
  email: "hey@hazhir.dev",
  links: [
    { label: "GitHub", href: "https://github.com/zin-yes" },
    { label: "LinkedIn", href: "https://www.linkedin.com/in/hazhir-taher/" },
  ],
  summary:
    "Self-taught and passionate programmer; programming since age 10. Confident and proactive in both collaborative and independent projects, with strong communication and problem-solving skills. More than five years of experience in real world full-stack projects using Next.js (TypeScript). Alongside an equivalent level of competence and passion in computer graphics and game programming.",
  experience: [
    {
      title: "Technical co-founder | Atlas",
      meta: "Jun 2025 - Dec 2025",
      links: [{ label: "Website", href: "https://useatlas.io" }],
      bullets: [
        "I together with my co-founder made it into the Antler residency program & worked on expanding the product rapidly.",
        "Working as part of a small founding team to design, build, and maintain a SaaS platform currently serving paying customers (30k SEK MRR).",
        "Full-stack development & system design with a focus on rapid feature delivery and bug fixes based on user feedback.",
        "Collaborating closely with early users to iterate fit and deliver a polished, reliable user experience.",
        "Experience in taking initiative, working independently, and maintaining motivation in a fast-moving startup environment.",
      ],
    },
    {
      title: "Technical co-founder | Valufy",
      meta: "2023 - 2024",
      bullets: [
        "In a period of 6 months I alone designed, coded, and iterated the infrastructure (SST/AWS) and developed a web & mobile product with my two other co-founders for our start up using feedback from beta testers.",
        "Eventually we presented our product at VentureCup - Regional Final East.",
      ],
    },
    {
      title: "Game developer | YouTube game show - Mithzan",
      meta: "2020 - 2022",
      links: [
        {
          label: "YouTube playlist",
          href: "https://www.youtube.com/playlist?list=PLywSVrtzaGBxRotOjompZieQbUG2vtM9Y",
        },
      ],
      bullets: [
        "Developed Minecraft game show from the ground up using Spigot A.P.I. in Java - with a tight feedback loop with the client - for a large group (~10) of YouTube creators. The result of which was a game show highly loved by their large audiences - 5k+ avg. likes, 40k+ avg. viewers, and 500k highest (in group) YouTube channel subscriber count.",
        "You can view the results on this YouTube playlist here.",
      ],
    },
  ],
  projects: [
    {
      title: "hazhir.dev | Web dev. portfolio",
      links: [
        { label: "Live Website", href: "https://hazhir.dev" },
        {
          label: "GitHub Repository",
          href: "https://github.com/zin-yes/hazhir.dev",
        },
      ],
      paragraphs: [
        "A operating system themed project containing two sub projects - a virtual web terminal - with a command line routine written from scratch, and a voxel game with infinite and advanced world generation using Three.js (WebGL) for rendering. You can see and use both by visiting the website linked on the top right.",
        "The project is coded using Next.js & TailwindCSS, in TypeScript and has auth (Auth.js), a database (Drizzle ORM) set up. It also uses Vercel as a CI/CD back-end.",
      ],
    },
    {
      title: "Gamma engine | High-performance Java 3D game engine",
      links: [
        { label: "GitHub Repository", href: "#" },
        { label: "Devlogs (YouTube)", href: "#" },
      ],
      paragraphs: [
        "Since creating a game engine from scratch is one of the biggest undertakings you can do as a solo programmer it has been my longest running project yet, and the one that has taught me the most.",
        "100+ fps avg. on my mid-tier computer, at a high polygon count (~150k polygons) and high resolution textures.",
        "Contains a range of industry standard graphics rendering features (e.g. physically-based rendering).",
        "I have used this game engine to successfully create games for my friends and I with minimal hassle.",
      ],
    },
    {
      title: "metricjournal.com | Personal journaling app",
      links: [
        { label: "Live Website", href: "https://metricjournal.com" },
        {
          label: "GitHub Repository",
          href: "https://github.com/zin-yes/metricjournal",
        },
      ],
      paragraphs: [
        "A SaaS that I was working on to help me journal in real-time to keep note of what things I do for how long. Currently it’s on pause.",
        "Uses the same underlying tech stack as is mentioned under the hazhir.dev project.",
      ],
    },
  ],
  education: [
    {
      school: "JENSEN Yrkeshögskola (2025-2027)",
      program: "IoT- och embeddedutveckling",
    },
    {
      school: "Berzeliusskolans gymnasium (2019-2023)",
      program: "Naturvetenskapsprogrammet",
    },
  ],
  languages: [
    { name: "English", level: "fluent" },
    { name: "Swedish", level: "fluent" },
  ],
  favorites: [
    "JavaScript/TypeScript",
    "NextJS/ReactJS",
    "TailwindCSS",
    "Java",
    "C++",
    "Python",
    "Git",
    "Vercel",
    "UI/UX Design",
    "Graphics Rendering",
    "Game Development",
  ],
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function generateCVDocumentHtml(): string {
  const links = cvData.links
    .map(
      (link) =>
        `<a class="underline" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
    )
    .join(" · ");

  const headerMetaParts = [
    escapeHtml(cvData.location),
    escapeHtml(cvData.phone),
    `<a class="underline" href="mailto:${escapeHtml(cvData.email)}">${escapeHtml(cvData.email)}</a>`,
    links,
  ];

  const headerMeta = headerMetaParts
    .map((part) => `<span>${part}</span>`)
    .join('<span class="meta-dot" aria-hidden="true">●</span>');

  const experienceItems = cvData.experience
    .map((entry) => {
      const title = entry.title;
      const dateChip = entry.meta
        ? `<span class="date-chip">${escapeHtml(entry.meta)}</span>`
        : "";
      const entryLinks =
        "links" in entry && entry.links && entry.links.length > 0
          ? `<div class="entry-links">${entry.links
              .map(
                (link: CVLink) =>
                  `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
              )
              .join("")}</div>`
          : "";
      const entryMeta =
        dateChip || entryLinks
          ? `<div class="entry-meta">${dateChip}${entryLinks}</div>`
          : "";

      return `<li>
  <div class="entry-header">
    <p class="entry-title">${escapeHtml(title)}</p>
    ${entryMeta}
  </div>
  <ul class="bullets">
    ${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
  </ul>
</li>`;
    })
    .join("");

  const projectItems = cvData.projects
    .map((entry) => {
      const entryLinks =
        entry.links && entry.links.length > 0
          ? `<div class="entry-links">${entry.links
              .map(
                (link) =>
                  `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
              )
              .join("")}</div>`
          : "";

      return `<li>
  <div class="entry-header">
    <p class="entry-title">${escapeHtml(entry.title)}</p>
    ${entryLinks}
  </div>
  <ul class="bullets">
    ${entry.paragraphs
      .map((paragraph) => `<li>${escapeHtml(paragraph)}</li>`)
      .join("")}
  </ul>
</li>`;
    })
    .join("");

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
      }
      .header {
        padding-bottom: 4px;
      }
      .name {
        margin: 0;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: 0.01em;
      }
      .meta {
        margin-top: 8px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        line-height: 1.45;
      }
      .meta-dot {
        display: inline-block;
        font-size: 10.5px;
        line-height: 1;
        margin: 0 6px;
        transform: translateY(1px);
      }
      .section {
        margin-top: 24px;
      }
      .intro-section {
        margin-top: 10px;
      }
      .section-title {
        margin: 0;
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .section-divider {
        margin-top: 6px;
        width: 100%;
        height: 1px;
        background: var(--line);
      }
      .summary {
        margin-top: 10px;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.65;
        letter-spacing: 0.01em;
      }
      .list {
        margin: 10px 0 0;
        padding: 0;
        list-style: none;
      }
      .list > li { margin-bottom: 12px; }
      .entry-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .entry-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .entry-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .entry-links {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
        font-size: 12px;
        text-align: right;
        letter-spacing: 0.01em;
      }
      .date-chip {
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
      }
      .entry-links a,
      .meta a { color: inherit; text-decoration: underline; }
      .bullets {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.65;
        list-style: none;
        padding-left: 0;
        letter-spacing: 0.01em;
      }
      .bullets li {
        position: relative;
        padding-left: 16px;
      }
      .bullets li::before {
        content: "•";
        position: absolute;
        left: 0;
        top: 0.1em;
        font-size: 16px;
        line-height: 1;
        color: #334155;
      }
      .two-col {
        margin-top: 24px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .plain-list {
        margin: 10px 0 0;
        padding-left: 0;
        list-style: none;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.65;
        letter-spacing: 0.01em;
      }
      .plain-list li { margin-bottom: 8px; }
      .plain-list strong { color: var(--fg); }
      .chips {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: var(--chip);
        color: #334155;
        padding: 4px 8px;
        font-size: 12px;
        line-height: 1.2;
        letter-spacing: 0.01em;
      }
      .page-break {
        display: block;
        break-before: page;
        page-break-before: always;
      }
      @media (max-width: 760px) {
        .entry-header {
          flex-direction: column;
          gap: 4px;
        }
        .entry-meta {
          justify-content: flex-start;
        }
        .entry-links {
          justify-content: flex-start;
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <h1 class="name">${escapeHtml(cvData.name)}</h1>
        <p class="meta">${headerMeta}</p>
      </header>
      <div class="section-divider"></div>

      <section class="section intro-section">
        <p class="summary">${escapeHtml(cvData.summary)}</p>
      </section>

      <section class="section">
        <h2 class="section-title">Experience</h2>
        <div class="section-divider"></div>
        <ul class="list">${experienceItems}</ul>
      </section>

      <div class="page-break"></div>

      <section class="section">
        <h2 class="section-title">Projects</h2>
        <div class="section-divider"></div>
        <ul class="list">${projectItems}</ul>
      </section>

      <section class="two-col">
        <div>
          <h2 class="section-title">Education</h2>
          <div class="section-divider"></div>
          <ul class="plain-list">
            ${cvData.education
              .map(
                (entry) =>
                  `<li><strong>${escapeHtml(entry.school)}</strong><br/>${escapeHtml(entry.program)}</li>`,
              )
              .join("")}
          </ul>
        </div>
        <div>
          <h2 class="section-title">Languages</h2>
          <div class="section-divider"></div>
          <ul class="plain-list">
            ${cvData.languages
              .map(
                (entry) =>
                  `<li><strong>${escapeHtml(entry.name)}</strong> — ${escapeHtml(entry.level)}</li>`,
              )
              .join("")}
          </ul>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">Favorites</h2>
        <div class="section-divider"></div>
        <div class="chips">
          ${cvData.favorites
            .map(
              (favorite) => `<span class="chip">${escapeHtml(favorite)}</span>`,
            )
            .join("")}
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function Divider() {
  return <div className="h-px w-full bg-border" />;
}

function Header({
  name,
  location,
  phone,
  email,
  links,
}: {
  name: string;
  location: string;
  phone: string;
  email: string;
  links: readonly CVLink[];
}) {
  const items = [location, phone, email, ...links.map((link) => link.label)];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xl font-bold tracking-wide text-foreground sm:text-2xl">
        {name}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        {items.map((item, index) => {
          const isLink = links.some((link) => link.label === item);
          return (
            <div key={`${item}-${index}`} className="flex items-center gap-2">
              {isLink ? (
                <a
                  href={links.find((link) => link.label === item)?.href}
                  className="underline"
                >
                  {item}
                </a>
              ) : item === email ? (
                <a href={`mailto:${email}`} className="underline">
                  {item}
                </a>
              ) : (
                <span>{item}</span>
              )}
              {index < items.length - 1 && (
                <span className="inline-block size-[1.875] rounded-full bg-foreground" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-bold uppercase tracking-wide text-foreground sm:text-base">
        {title}
      </p>
      <Divider />
    </div>
  );
}

function ExperienceItem({ entry }: { entry: ExperienceEntry }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-base font-semibold text-foreground sm:text-lg">
          {entry.title}
        </p>
        {entry.meta || entry.links?.length ? (
          <div className="flex flex-row flex-wrap items-center gap-2 text-sm font-medium text-foreground sm:justify-end sm:text-base">
            {entry.meta ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tracking-wide text-muted-foreground">
                {entry.meta}
              </span>
            ) : null}
            {entry.links?.map((link) => (
              <a key={link.label} href={link.href} className="underline">
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-sm font-medium text-muted-foreground sm:text-base">
        {entry.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}

function ProjectItem({ entry }: { entry: ProjectEntry }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-base font-semibold text-foreground sm:text-lg">
          {entry.title}
        </p>
        {entry.links?.length ? (
          <div className="flex flex-row flex-nowrap items-center gap-2 text-sm font-semibold text-foreground sm:text-base">
            {entry.links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="whitespace-nowrap underline"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="list-disc space-y-1 pl-4 text-sm font-normal text-muted-foreground sm:text-base">
        {entry.paragraphs.map((paragraph) => (
          <li key={paragraph}>{paragraph}</li>
        ))}
      </ul>
    </div>
  );
}

function EducationItem({ entry }: { entry: EducationEntry }) {
  return (
    <div className="text-sm text-foreground sm:text-base">
      <p className="font-semibold">{entry.school}</p>
      <p className="font-medium text-muted-foreground">{entry.program}</p>
    </div>
  );
}

function LanguageItem({ entry }: { entry: LanguageEntry }) {
  return (
    <p className="text-sm text-foreground sm:text-base">
      <span className="font-semibold">{entry.name} — </span>
      <span className="font-medium text-muted-foreground">{entry.level}</span>
    </p>
  );
}

function FavoriteTag({ label }: { label: string }) {
  return (
    <span className="rounded bg-foreground px-2 py-0.5 text-xs text-background sm:text-sm">
      {label}
    </span>
  );
}

export default function CVDocument() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 bg-background px-4 py-4 text-foreground !select-text sm:px-6 sm:py-5">
      <Header
        name={cvData.name}
        location={cvData.location}
        phone={cvData.phone}
        email={cvData.email}
        links={cvData.links}
      />
      <Divider />
      <p className="text-sm font-medium text-muted-foreground sm:text-base">
        {cvData.summary}
      </p>

      <SectionHeader title="Experience" />
      <div className="flex flex-col gap-3">
        {cvData.experience.map((entry) => (
          <ExperienceItem key={entry.title} entry={entry} />
        ))}
      </div>

      <SectionHeader title="Projects" />
      <div className="flex flex-col gap-3">
        {cvData.projects.map((entry) => (
          <ProjectItem key={entry.title} entry={entry} />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <SectionHeader title="Education" />
          <div className="flex flex-col gap-2">
            {cvData.education.map((entry) => (
              <EducationItem key={entry.school} entry={entry} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <SectionHeader title="Languages" />
          <div className="flex flex-col gap-1">
            {cvData.languages.map((entry) => (
              <LanguageItem key={entry.name} entry={entry} />
            ))}
          </div>
        </div>
      </div>

      <SectionHeader title="Favorites" />
      <div className="flex flex-wrap gap-2">
        {cvData.favorites.map((favorite) => (
          <FavoriteTag key={favorite} label={favorite} />
        ))}
      </div>
    </div>
  );
}
