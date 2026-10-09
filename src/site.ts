export const site = {
  name: "Hanna Kessler",
  role: "",
  description: "",
  photo: "/images/profile-placeholder.svg",
  resumeUrl: "",
  email: "",
  links: {
    github: "https://github.com/HannaKessler",
    linkedin: "",
  },
  intro: [] as string[],
  experience: [] as { title: string; detail: string }[],
};

export function contactLinks() {
  return [
    site.email ? { label: "Email", href: `mailto:${site.email}` } : null,
    site.links.github ? { label: "GitHub", href: site.links.github } : null,
    site.links.linkedin ? { label: "LinkedIn", href: site.links.linkedin } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);
}
