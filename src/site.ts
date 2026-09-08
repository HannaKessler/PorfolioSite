export const site = {
  name: "Hanna Kessler",
  role: "Game Developer & Software Engineer",
  description:
    "Selected games, software, and playable demos. Full games live on itch.io.",
  photo: "/images/profile-placeholder.svg",
  resumeUrl: "",
  email: "",
  links: {
    github: "https://github.com/HannaKessler",
    itch: "",
    linkedin: "",
  },
  intro: [
    "I make games and software, with playable work on itch.io and engineering projects on GitHub.",
    "I’m looking for roles where I can ship games and the tools around them.",
  ],
  experience: [
    {
      title: "Game development",
      detail:
        "Replace this with engines, roles, and shipped titles. Link finished games from the Games carousel below.",
    },
    {
      title: "Software engineering",
      detail:
        "Replace this with languages, systems, and products you’ve built. Software cards live in the carousel above Games.",
    },
  ],
};

export function contactLinks() {
  return [
    site.email ? { label: "Email", href: `mailto:${site.email}` } : null,
    site.links.github ? { label: "GitHub", href: site.links.github } : null,
    site.links.itch ? { label: "itch.io", href: site.links.itch } : null,
    site.links.linkedin ? { label: "LinkedIn", href: site.links.linkedin } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);
}
