export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-slate-950/80 backdrop-blur border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-bold text-white tracking-tight">Alex Rivera</span>
          <div className="flex items-center gap-6">
            <a href="#about" className="nav-link">About</a>
            <a href="#skills" className="nav-link">Skills</a>
            <a href="#projects" className="nav-link">Projects</a>
            <a href="#experience" className="nav-link">Experience</a>
            <a href="#contact" className="btn-primary text-xs px-4 py-2">Contact</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section id="about" className="pt-40 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-blue-400 text-sm font-semibold tracking-widest uppercase mb-4">Portfolio Briefing</p>
          <h1 className="text-5xl sm:text-6xl font-extrabold text-white leading-tight mb-6">
            Hi, I&apos;m <span className="gradient-text">Alex Rivera</span>
          </h1>
          <p className="text-xl text-slate-400 max-w-2xl leading-relaxed mb-10">
            Full-stack engineer with 8+ years building scalable web products. I specialize in
            React, Node.js, and cloud infrastructure — turning complex problems into clean,
            maintainable solutions.
          </p>
          <div className="flex flex-wrap gap-4">
            <a href="#projects" className="btn-primary">View Projects</a>
            <a href="#contact" className="btn-secondary">Get in Touch</a>
          </div>
        </div>
      </section>

      {/* Skills */}
      <section id="skills" className="py-24 px-6 bg-slate-900/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="section-heading">Skills</h2>
          <p className="section-subheading">Technologies I work with regularly</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {skills.map((group) => (
              <div key={group.category} className="card">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">{group.category}</h3>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((skill) => (
                    <span key={skill} className="tag">{skill}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Projects */}
      <section id="projects" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="section-heading">Projects</h2>
          <p className="section-subheading">A selection of things I&apos;ve built</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {projects.map((project) => (
              <div key={project.title} className="card flex flex-col gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white mb-2">{project.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{project.description}</p>
                </div>
                <div className="flex flex-wrap gap-2 mt-auto">
                  {project.tags.map((tag) => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Experience */}
      <section id="experience" className="py-24 px-6 bg-slate-900/40">
        <div className="max-w-5xl mx-auto">
          <h2 className="section-heading">Experience</h2>
          <p className="section-subheading">Where I&apos;ve worked</p>
          <div className="flex flex-col gap-6">
            {experience.map((job) => (
              <div key={job.company} className="card">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-white">{job.role}</h3>
                    <p className="text-blue-400 text-sm font-medium">{job.company}</p>
                  </div>
                  <span className="text-slate-500 text-sm whitespace-nowrap">{job.period}</span>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">{job.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="section-heading">Get in Touch</h2>
          <p className="section-subheading mx-auto max-w-xl">
            I&apos;m currently open to new opportunities. Whether you have a question or just want to say hi, my inbox is always open.
          </p>
          <a href="mailto:alex@example.com" className="btn-primary mx-auto">
            Say Hello
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 px-6 text-center text-slate-600 text-sm">
        © {new Date().getFullYear()} Alex Rivera. Built with Next.js &amp; Tailwind CSS.
      </footer>
    </main>
  );
}

const skills = [
  {
    category: "Frontend",
    items: ["React", "Next.js", "TypeScript", "Tailwind CSS", "Framer Motion"],
  },
  {
    category: "Backend",
    items: ["Node.js", "Express", "PostgreSQL", "Redis", "GraphQL"],
  },
  {
    category: "Infrastructure",
    items: ["AWS", "Docker", "Kubernetes", "GitHub Actions", "Terraform"],
  },
];

const projects = [
  {
    title: "DataFlow Dashboard",
    description:
      "A real-time analytics dashboard for monitoring business KPIs. Built with Next.js, WebSockets, and PostgreSQL. Handles 50k+ events per minute.",
    tags: ["Next.js", "TypeScript", "PostgreSQL", "WebSockets"],
  },
  {
    title: "OpenCart API",
    description:
      "RESTful API powering a multi-vendor e-commerce platform. Features JWT auth, payment processing, and inventory management at scale.",
    tags: ["Node.js", "Express", "Redis", "Stripe"],
  },
  {
    title: "DevCollab",
    description:
      "A collaborative code review tool with inline comments, threaded discussions, and GitHub integration. Used by 2,000+ developers.",
    tags: ["React", "GraphQL", "AWS", "Docker"],
  },
  {
    title: "CloudSync CLI",
    description:
      "A command-line tool for syncing files across cloud providers (S3, GCS, Azure Blob). Supports encryption, compression, and incremental sync.",
    tags: ["Node.js", "AWS S3", "TypeScript", "CLI"],
  },
];

const experience = [
  {
    role: "Senior Software Engineer",
    company: "Acme Corp",
    period: "2022 – Present",
    description:
      "Lead engineer on the core platform team. Architected a microservices migration that reduced p99 latency by 40%. Mentor junior engineers and drive technical roadmap discussions.",
  },
  {
    role: "Software Engineer",
    company: "StartupXYZ",
    period: "2019 – 2022",
    description:
      "Full-stack engineer on a 6-person team building a SaaS analytics product from zero to Series A. Owned the frontend architecture and data pipeline integrations.",
  },
  {
    role: "Junior Developer",
    company: "Web Agency Co.",
    period: "2017 – 2019",
    description:
      "Built client websites and web apps using React and WordPress. Delivered 20+ projects across industries including finance, healthcare, and e-commerce.",
  },
];
