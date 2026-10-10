/**
 * GraphQL documents for the explorer presets. These are the persisted
 * operations: the backend's allowlist is built from this list at build time,
 * and the explorer can send just their SHA-256 hash instead of the text.
 */
export const DIRECTOR_WITH_CAST = `query DirectorWithCast($id: ID!) {
  person(id: $id) {
    name
    birthYear
    directed: credits(role: DIRECTOR) {
      film {
        title
        year
        cast: credits(role: ACTOR) {
          billingOrder
          character
          person {
            name
          }
        }
      }
    }
  }
}`;

export const FILMOGRAPHY_BY_DECADE = `query FilmographyByDecade($id: ID!) {
  person(id: $id) {
    name
    byDecade: creditsByDecade(role: ACTOR) {
      decade
      credits {
        character
        film {
          title
          year
          genres {
            name
          }
        }
      }
    }
  }
}`;

export const SHARED_FILMS = `query SharedFilms($a: ID!, $b: ID!) {
  a: person(id: $a) {
    name
  }
  b: person(id: $b) {
    name
  }
  sharedFilms(personA: $a, personB: $b) {
    title
    year
    directors {
      name
    }
  }
}`;

export const STUDIO_OUTPUT = `query StudioOutput($id: ID!) {
  studio(id: $id) {
    name
    filmCount
    genreBreakdown {
      decade
      genre {
        name
      }
      count
    }
  }
}`;

export const ACTOR_PATH = `query ActorPath($from: ID!, $to: ID!) {
  from: person(id: $from) {
    name
  }
  to: person(id: $to) {
    name
  }
  actorPath(from: $from, to: $to, maxHops: 3) {
    hops
    steps {
      from {
        name
      }
      film {
        title
        year
      }
      to {
        name
      }
    }
  }
}`;

/** The N+1 demo: a film's cast, then every cast member's other films. */
export const SIX_DEGREES = `query SixDegrees($id: ID!) {
  film(id: $id) {
    title
    year
    cast: credits(role: ACTOR) {
      person {
        name
        filmography: credits(role: ACTOR) {
          film {
            title
            year
          }
        }
      }
    }
  }
}`;

export const PERSISTED_DOCUMENTS = [
  DIRECTOR_WITH_CAST,
  FILMOGRAPHY_BY_DECADE,
  SHARED_FILMS,
  STUDIO_OUTPUT,
  ACTOR_PATH,
  SIX_DEGREES,
];
