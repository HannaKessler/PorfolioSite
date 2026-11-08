---
title: Narrative RPG
description: >
  This game is inspired by Warriors (Warrior Cats), a book series I loved as a child. At its core, it's a Fallout: New Vegas-style RPG, but with cats. The player creates a customized character, explores the environment, meets other cats, and builds relationships with individuals and groups. The game features hunting, herb gathering and healing, stealth, and real-time "paw to paw" combat. The focus is on the fantasy of bringing your own character to life, and on making choices that shape how the story plays out and how other characters treat you.
tagline: Unannounced game project
pubDate: 2026-11-08
kind: project
listed: true
status: In development
tags:
  - Unity
  - C#
  - Blender
---

This game is inspired by Warriors (Warrior Cats), a book series I loved as a child. At its core, it's a Fallout: New Vegas-style RPG, but with cats. The player creates a customized character, explores the environment, meets other cats, and builds relationships with individuals and groups. The game features hunting, herb gathering and healing, stealth, and real-time "paw to paw" combat. The focus is on the fantasy of bringing your own character to life, and on making choices that shape how the story plays out and how other characters treat you.

## Systems

### Character Customization

Customization is a core part of the game. I want to give players enough creative control to bring the character they imagine to life. Much of the target audience may have a character they've drawn the same way for years, so I want to support as much customization as possible. The customizer offers swappable mesh options for details like ears, tails, and face shape, and uses blend shapes to adjust the cat's proportions. It also includes a full suite of painting tools for designing the cat's fur, with a layer system that supports blending, masking, and more. Preset patterns can be used as stamps, or the entire coat can be drawn from scratch.

### Movement

Full 3D movement is supported, with the goal of making the player feel highly mobile. Cats can climb, jump, walk gracefully along thin surfaces like fences, run fast, and move stealthily. The movement system includes a jump target system that detects the player's intent for pathing, making it easy to run and jump through a variety of obstacles and environments.

### Prey and Hunting

To make the world feel alive, it will be full of animals the player can hunt. Animal spawning and instance management are controlled by proximity to the player, as well as location-based density targets and rarity percentages. A desired density of instances is maintained by replacing any that leave the player's radius. Instances always spawn outside the player's vision and beyond a spawn radius, so they appear to have been in the environment all along rather than popping in suddenly.

Each instance's life cycle is tracked simply until it enters the player's detection radius (for sound) or visual field. At that point, it is fully instantiated as an animal AI with individual behavior, and it stays that way for as long as it remains in the player's visual or audio field. Animals have different behaviors based on their species, as well as randomized stats such as how cautious they are. They exhibit a variety of idle behaviors like foraging, exploring, or resting, and once they detect danger, they use evasion behaviors to avoid capture. Catching prey requires the player to observe their surroundings and use skill and patience to get close enough to successfully execute an ambush or chase.

### Relationships

The game features several groups, each made up of a variety of cat characters the player can interact with. Relationships are built through dialog options, completed quests, and other gameplay actions. The player has a relationship with each individual as well as with the group overall, and these values are combined to determine which interactions are available with that individual. This will be a major focus of both linear and non-linear story arcs throughout the game. Relationships also determine where the player can go safely and where they must stay alert for attacks.

### Party

During certain parts of the game, the player can recruit NPCs to join their party temporarily. Party members can assist with combat, conversation, hunting, and other tasks.

### Combat

Combat is real time and centers on timing dodges and counterattacks and managing space. Different builds approach combat differently: a heavy, strong bruiser might attack head-on, while a nimble, quick attacker might focus on avoiding hits. The player can also command party members to focus on specific targets or to play it safe.
