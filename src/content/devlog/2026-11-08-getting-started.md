---
title: Getting Started
date: 2026-11-08
---

![A tabby cat sitting on gray platforms in an early scene](/images/narrative-rpg/getting-started.png)

I'm a mostly solo developer, working with a couple of friends who are 3D artists. I'm technically skilled in 3D, enough to be dangerous, but it's always a pleasure working with great artists who really bring your ideas to life.

<figure class="gif-player">
  <img src="/images/narrative-rpg/locomotion.gif" alt="A tabby cat walking away across gray platforms" />
  <button type="button" class="gif-player-toggle" aria-pressed="false" aria-label="Pause">
    <svg class="gif-icon-pause" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2" width="3.2" height="12" rx="0.6" fill="currentColor" />
      <rect x="9.8" y="2" width="3.2" height="12" rx="0.6" fill="currentColor" />
    </svg>
    <svg class="gif-icon-play" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.2 2.6v10.8L13.4 8z" fill="currentColor" />
    </svg>
  </button>
</figure>

My artist friends have created a beautiful cat character for me. None of us are animators, though, so I purchased the cat asset shown above to borrow animations from and retrofit onto our custom character. For now, I'm working with this asset to make sure everything functions well before applying the new visual layer.

To support this workflow, I wrote a [Blender add-on](/projects/blender-asset-transformer). With it, I can import, edit, and apply animations directly to the new mesh, which lets me seamlessly swap the placeholder for the final art.

Right now, I'm focused on finalizing locomotion across various surfaces.
