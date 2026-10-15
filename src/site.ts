export const site = {
  name: "Hanna Kessler",
  role: "",
  description: "",
  photo: "/images/profile.jpg",
  resumeUrl: "",
  email: "",
  links: {
    github: "https://github.com/HannaKessler",
    linkedin: "https://www.linkedin.com/in/hanna-kessler-7448a0173/",
    itch: "https://hannakessler.itch.io/",
  },
  intro: [
    "I'm a software engineer with four years of experience across web development, cloud infrastructure, game development, and 3D data pipelines. Working across such different domains has made me comfortable navigating unfamiliar systems and learning new technologies. I also lead a team of developers and artists competing in timed game development competitions. Outside of software, I enjoy exploring the intersection of technology and traditional art practices, particularly using CAD, 3D printing, and CNC machining in my ceramics work.",
  ] as string[],
  experience: [] as { title: string; detail: string }[],
};

export function contactLinks() {
  return [
    site.email ? { label: "Email", href: `mailto:${site.email}` } : null,
    site.links.github ? { label: "GitHub", href: site.links.github } : null,
    site.links.linkedin ? { label: "LinkedIn", href: site.links.linkedin } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);
}
