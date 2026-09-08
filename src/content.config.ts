import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    kind: z.enum(["game", "software"]),
    pubDate: z.coerce.date(),
    featured: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    itchUrl: z.string().url().optional(),
    githubUrl: z.string().url().optional(),
    liveUrl: z.string().url().optional(),
    demoUrl: z.string().optional(),
    image: z
      .object({
        src: z.string(),
        alt: z.string(),
      })
      .optional(),
  }),
});

export const collections = { projects };
