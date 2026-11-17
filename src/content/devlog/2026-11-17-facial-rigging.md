---
title: Facial Rigging
date: 2026-11-17
---

<figure class="gif-player gif-player-half">
  <img src="/images/narrative-rpg/facial-rigging.gif" alt="Blender close-up of the cat's face with the jaw bone selected while posing the mouth" />
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

Working on rigging up the character's face. The face and ear animations will be driven by a different system than the general locomotion animations, to enable layers like facial expressions to work with any animation. Started with the easiest part of the rig, the bottom jaw. Pretty happy with how it is looking so far. I prefer to create constraint driven handles rather than using bones directly.

Eventually, I plan to try to get the mouth to form the standard animation phoneme shapes, but the anatomy of a cat's mouth is obviously different than a human character so I will have to see what I can do without making it look like an early 2000s talking animal movie.