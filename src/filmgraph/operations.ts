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
    asA: credits(role: ACTOR, person: $a) {
      character
    }
    asB: credits(role: ACTOR, person: $b) {
      character
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

/** Autocomplete for the question builder's blanks: people, optionally by role. */
export const PEOPLE_SEARCH = `query PeopleSearch($text: String!, $role: Role, $first: Int = 8) {
  people(search: $text, role: $role, first: $first) {
    edges {
      node {
        id
        name
        birthYear
        knownFor(role: $role) {
          title
          year
        }
      }
    }
  }
}`;

/** Autocomplete for studio blanks. */
export const STUDIO_SEARCH = `query StudioSearch($text: String!, $first: Int = 8) {
  studios(search: $text, first: $first) {
    edges {
      node {
        id
        name
        filmCount
        knownFor {
          title
          year
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
  PEOPLE_SEARCH,
  STUDIO_SEARCH,
];
