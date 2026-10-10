import type { ReactNode } from "react";
import { formatCount } from "../../filmgraph/client/metrics";

export type AnswerState =
  | { kind: "idle" }
  | { kind: "booting"; detail: string }
  | { kind: "running" }
  | { kind: "error"; message: string }
  | { kind: "custom" }
  | { kind: "done"; presetId: string; data: any };

interface Props {
  state: AnswerState;
  /** The question changed since these results were fetched. */
  stale: boolean;
  /** The sentence the results answer, e.g. "Every film Christopher Nolan directed…". */
  question: string | null;
  runCount: number;
}

const plural = (count: number, one: string, many = `${one}s`) => `${formatCount(count)} ${count === 1 ? one : many}`;
const filmLabel = (film: { title: string; year: number }) => (
  <>
    <cite>{film.title}</cite> <span className="fg-ans-year">({film.year})</span>
  </>
);

function NotFound({ what }: { what: string }) {
  return <p className="fg-ans-empty">No {what} with that ID in this database.</p>;
}

function Director({ data }: { data: any }) {
  const person = data?.person;
  if (!person) return <NotFound what="person" />;
  const films: any[] = person.directed ?? [];
  return (
    <>
      <p className="fg-ans-summary">
        <strong>{person.name}</strong> directed {plural(films.length, "film")} in this database
        {films.length ? `, from ${films[0].film.year} to ${films[films.length - 1].film.year}` : ""}.
      </p>
      {films.length ? (
        <ol className="fg-ans-films">
          {films.map(({ film }, index) => (
              <li key={index}>
                <h4>{filmLabel(film)}</h4>
                {film.cast.length ? (
                  <ul className="fg-ans-cast" aria-label={`Cast of ${film.title}`}>
                    {film.cast.map((credit: any, castIndex: number) => (
                      <li key={castIndex}>
                        <span className="fg-ans-person">{credit.person.name}</span>
                        {credit.character && <span className="fg-ans-role"> as {credit.character}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="fg-ans-muted">No billed cast recorded.</p>
                )}
              </li>
            ))}
        </ol>
      ) : (
        <p className="fg-ans-empty">No directing credits recorded for {person.name}.</p>
      )}
    </>
  );
}

function Filmography({ data }: { data: any }) {
  const person = data?.person;
  if (!person) return <NotFound what="person" />;
  const decades: any[] = person.byDecade ?? [];
  const total = decades.reduce((sum, group) => sum + group.credits.length, 0);
  return (
    <>
      <p className="fg-ans-summary">
        <strong>{person.name}</strong> has {plural(total, "acting credit")}
        {decades.length ? ` across ${plural(decades.length, "decade")}, ${decades[0].decade}s to ${decades[decades.length - 1].decade}s` : ""}.
      </p>
      {decades.length ? (
        <ul className="fg-ans-decades">
          {decades.map((group) => (
              <li key={group.decade}>
                <h4>
                  {group.decade}s <span className="fg-ans-count">{plural(group.credits.length, "film")}</span>
                </h4>
                <ul className="fg-ans-credits">
                  {group.credits.map((credit: any, index: number) => (
                    <li key={index}>
                      {filmLabel(credit.film)}
                      <span className="fg-ans-role">{credit.character ? ` as ${credit.character}` : " (role not listed)"}</span>
                      {credit.film.genres.length > 0 && (
                        <span className="fg-ans-tags">{credit.film.genres.map((genre: any) => genre.name).join(", ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
      ) : (
        <p className="fg-ans-empty">No acting credits recorded for {person.name}.</p>
      )}
    </>
  );
}

function Shared({ data }: { data: any }) {
  if (!data?.a || !data?.b) return <NotFound what="person" />;
  const films: any[] = data.sharedFilms ?? [];
  const as = (list: any[]) => (list?.[0]?.character ? `as ${list[0].character}` : "role not listed");
  return (
    <>
      <p className="fg-ans-summary">
        <strong>{data.a.name}</strong> and <strong>{data.b.name}</strong>{" "}
        {films.length ? `appear together in ${plural(films.length, "film")}.` : "never appear in the same film here."}
      </p>
      {films.length ? (
        <ol className="fg-ans-films">
          {films.map((film, index) => (
              <li key={index}>
                <h4>{filmLabel(film)}</h4>
                {film.directors.length > 0 && (
                  <p className="fg-ans-muted">Directed by {film.directors.map((d: any) => d.name).join(" and ")}</p>
                )}
                <ul className="fg-ans-cast">
                  <li>
                    <span className="fg-ans-person">{data.a.name}</span> <span className="fg-ans-role">{as(film.asA)}</span>
                  </li>
                  <li>
                    <span className="fg-ans-person">{data.b.name}</span> <span className="fg-ans-role">{as(film.asB)}</span>
                  </li>
                </ul>
              </li>
            ))}
        </ol>
      ) : (
        <p className="fg-ans-empty">
          None of the 2,000 films in this database bill both of them in the cast. Try another pair, or the shortest-link
          question to see how they connect.
        </p>
      )}
    </>
  );
}

function Studio({ data }: { data: any }) {
  const studio = data?.studio;
  if (!studio) return <NotFound what="studio" />;
  const rows: any[] = studio.genreBreakdown ?? [];
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.genre.name, (totals.get(row.genre.name) ?? 0) + row.count);
  const genres = [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([name]) => name);
  const decades = [...new Set(rows.map((row) => row.decade))].sort((a, b) => a - b);
  const count = (decade: number, genre: string) => rows.find((row) => row.decade === decade && row.genre.name === genre)?.count ?? 0;
  const max = Math.max(1, ...rows.filter((row) => genres.includes(row.genre.name)).map((row) => row.count));
  return (
    <>
      <p className="fg-ans-summary">
        <strong>{studio.name}</strong> made {plural(studio.filmCount, "film")} in this database
        {decades.length ? `, from the ${decades[0]}s to the ${decades[decades.length - 1]}s` : ""}
        {genres.length ? `. Its biggest genre is ${genres[0].toLowerCase()}.` : "."}
      </p>
      {genres.length ? (
        <div className="fg-ans-table-wrap" tabIndex={0} role="region" aria-label={`${studio.name} films by genre and decade`}>
          <table className="fg-ans-table">
            <caption className="visually-hidden">Number of {studio.name} films in its top genres, per decade</caption>
            <thead>
              <tr>
                <th scope="col">Decade</th>
                {genres.map((genre) => (
                  <th scope="col" key={genre}>
                    {genre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {decades.map((decade) => (
                <tr key={decade}>
                  <th scope="row">{decade}s</th>
                  {genres.map((genre) => {
                    const value = count(decade, genre);
                    return (
                      <td key={genre}>
                        <span className="fg-ans-cell" style={{ ["--fill" as string]: `${(value / max) * 100}%` }}>
                          {value || <span className="fg-ans-zero">–</span>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fg-ans-empty">No genre data recorded for {studio.name}'s films.</p>
      )}
      {genres.length > 0 && <p className="fg-ans-muted">Top {genres.length} genres. A film can count in several genres.</p>}
    </>
  );
}

function Path({ data }: { data: any }) {
  if (!data?.from || !data?.to) return <NotFound what="person" />;
  const path = data.actorPath;
  if (!path) {
    return (
      <>
        <p className="fg-ans-summary">
          <strong>{data.from.name}</strong> and <strong>{data.to.name}</strong> have no link within 3 films.
        </p>
        <p className="fg-ans-empty">No chain of up to 3 shared films connects them in this database.</p>
      </>
    );
  }
  if (path.hops === 0) {
    return (
      <p className="fg-ans-summary">
        That's the same person twice: <strong>{data.from.name}</strong>.
      </p>
    );
  }
  return (
    <>
      <p className="fg-ans-summary">
        <strong>{data.from.name}</strong> is {plural(path.hops, "film")} away from <strong>{data.to.name}</strong>.
      </p>
      <ol className="fg-chain" aria-label={`Link from ${data.from.name} to ${data.to.name}`}>
        <li className="fg-chain-person">{data.from.name}</li>
        {path.steps.map((step: any, index: number) => (
          <li key={index} className="fg-chain-step">
            <span className="fg-chain-film">
              <span className="visually-hidden">was in </span>
              {filmLabel(step.film)}
              <span className="visually-hidden"> with</span>
            </span>
            <span className="fg-chain-person">{step.to.name}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

const RENDERERS: Record<string, (props: { data: any }) => ReactNode> = {
  director: Director,
  filmography: Filmography,
  shared: Shared,
  studio: Studio,
  path: Path,
};

export function Answer({ state, stale, question, runCount }: Props) {
  let body: ReactNode;
  if (state.kind === "idle") {
    body = (
      <p className="fg-ans-placeholder">
        Pick a question, fill in the names, and press <strong>Run</strong>.
      </p>
    );
  } else if (state.kind === "booting") {
    body = <p className="fg-ans-placeholder">Setting up the database in your browser… {state.detail}</p>;
  } else if (state.kind === "running") {
    body = <p className="fg-ans-placeholder">Asking the database…</p>;
  } else if (state.kind === "error") {
    body = (
      <p className="fg-error-text" role="alert">
        {state.message}
      </p>
    );
  } else if (state.kind === "custom") {
    body = (
      <p className="fg-ans-placeholder">
        You edited the query by hand, so there is no formatted answer. The raw response is in the GraphQL result tab below.
      </p>
    );
  } else {
    const Render = RENDERERS[state.presetId];
    body = Render ? <Render data={state.data} /> : null;
  }
  return (
    <section className="fg-section" aria-labelledby="fg-answer-title">
      <div className="fg-section-head">
        <h2 id="fg-answer-title">Answer</h2>
        {question && state.kind === "done" && <p>{question}</p>}
      </div>
      <div className="fg-answer" data-state={state.kind} data-run={runCount} data-stale={stale || undefined} aria-busy={state.kind === "running" || state.kind === "booting"}>
        {stale && (
          <p className="fg-ans-stale" role="status">
            Out of date: you changed the question. Press Run to update.
          </p>
        )}
        {body}
      </div>
    </section>
  );
}
