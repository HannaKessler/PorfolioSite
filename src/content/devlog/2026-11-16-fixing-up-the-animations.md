---
title: Fixing Up the Animations
date: 2026-11-16
---

<figure class="devlog-side">
  <a href="/images/narrative-rpg/fixing-up-the-animations.webp">
    <img src="/images/narrative-rpg/fixing-up-the-animations.webp" alt="Grid of Blender renders comparing the cat's run, walk and trot frames with a reference line for the head height" width="900" height="1455" loading="lazy" />
  </a>
</figure>

Spent today cleaning up the cat's animations, with an AI assistant working directly inside my open Blender file through the Blender MCP, a plugin that lets it read and edit the scene live. The neck and head were scrunched down in the run clips. I posed the neck the way I wanted on a single frame, and the assistant used the MCP to read that pose, work out the offset from the original keys, and apply it to every frame of the forward, fast and turning runs, mirrored between left and right.

Because the MCP edits the session I'm already in rather than a copy of the file, each change showed up in my viewport right away and I could check it before moving on. We did the same for the walk and trot clips, so the head now sits at the same angle as in the idle.

I also tweaked two tail bones on one frame of the sit loop, and it carried that across all the sitting animations, fading the change in and out on the transitions. The edited clips were then exported into Unity and wired into the character's Animator through Unity's MCP.