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
  links: [{ label: "GitHub", href: "https://github.com/zin-yes" }, { label: "LinkedIn", href: "https://www.linkedin.com/in/hazhir-taher/" }],
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
      links: [{ label: "YouTube playlist", href: "https://www.youtube.com/playlist?list=PLywSVrtzaGBxRotOjompZieQbUG2vtM9Y" }],
      bullets: [
        "Developed Minecraft game show from the ground up using Spigot A.P.I. in Java - with a tight feedback loop with the client - for a large group (~10) of YouTube creators. The result of which was a game show highly loved by their large audiences - 5k+ avg. likes, 40k+ avg. viewers, and 500k highest (in group) YouTube channel subscriber count.",
        "You can view the results on this YouTube playlist here.",
      ],
    },
  ],
  projects: [
    {
      title: "hazhir.dev | Web dev. portfolio",
      links: [{ label: "Live Website", href: "https://hazhir.dev" }, { label: "GitHub Repository", href: "https://github.com/zin-yes/hazhir.dev" }],
      paragraphs: [
        "A operating system themed project containing two sub projects - a virtual web terminal - with a command line routine written from scratch, and a voxel game with infinite and advanced world generation using Three.js (WebGL) for rendering. You can see and use both by visiting the website linked on the top right.",
        "The project is coded using Next.js & TailwindCSS, in TypeScript and has auth (Auth.js), a database (Drizzle ORM) set up. It also uses Vercel as a CI/CD back-end.",
      ],
    },
    {
      title: "Gamma engine | High-performance Java 3D game engine",
      links: [{ label: "GitHub Repository", href: "#" }, { label: "Devlogs (YouTube)", href: "#" }],
      paragraphs: [
        "Since creating a game engine from scratch is one of the biggest undertakings you can do as a solo programmer it has been my longest running project yet, and the one that has taught me the most.",
        "100+ fps avg. on my mid-tier computer, at a high polygon count (~150k polygons) and high resolution textures.",
        "Contains a range of industry standard graphics rendering features (e.g. physically-based rendering).",
        "I have used this game engine to successfully create games for my friends and I with minimal hassle.",
      ],
    },
    {
      title: "metricjournal.com | Personal journaling app",
      links: [{ label: "Live Website", href: "https://metricjournal.com" }, { label: "GitHub Repository", href: "https://github.com/zin-yes/metricjournal" }],
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground sm:text-sm">
        {items.map((item, index) => {
          const isLink = links.some((link) => link.label === item);
          return (
            <div key={`${item}-${index}`} className="flex items-center gap-2">
              {isLink ? (
                <a href={links.find((link) => link.label === item)?.href} className="underline">
                  {item}
                </a>
              ) : (
                <span>{item}</span>
              )}
              {index < items.length - 1 && (
                <span className="inline-block size-1.5 rounded-full bg-foreground" />
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
          {entry.meta ? ` (${entry.meta})` : ""}
        </p>
        {entry.links?.length ? (
          <div className="flex flex-row flex-wrap items-center gap-2 text-sm font-medium text-foreground sm:text-base">
            {entry.links.map((link) => (
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
              <a key={link.label} href={link.href} className="whitespace-nowrap underline">
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
