/**
 * The watch page: the sessions on record, grouped by repository; the chosen
 * session's state in plain words, a graph of Claude, its tasks and its
 * helpers, and the feed of the selected node. Every view comes from `reduce`
 * over the session's lines, as the server streams them; the timeline moves
 * through a session by reducing only the lines up to a point.
 */
import { Background, ReactFlow, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { errand, phrase, words } from "../../lib/watch/phrases.mjs";
import { FREE, helperNode, reduce, taskNode } from "../../lib/watch/reduce.mjs";
import "./watch.css";

const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";
const lang = params.get("lang") === "es" ? "es" : "en";
const w = words(lang);
const api = (route, q = {}) => `${route}?${new URLSearchParams({ ...q, token })}`;

/** The session list, live. */
function useSessions() {
  const [sessions, setSessions] = useState(null);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const es = new EventSource(api("api/sessions"));
    es.addEventListener("sessions", (m) => {
      setLost(false);
      setSessions(JSON.parse(m.data));
    });
    es.onerror = () => setLost(true);
    return () => es.close();
  }, []);
  return [sessions, lost];
}

/** A session's lines, live. */
function useEvents(chosen) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    setEvents([]);
    if (!chosen) return undefined;
    const es = new EventSource(api("api/events", chosen));
    // A reconnect replays the file from the start: start over with it.
    es.onopen = () => setEvents([]);
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data);
        setEvents((all) => [...all, e]);
      } catch {}
    };
    return () => es.close();
  }, [chosen?.repo, chosen?.session]);
  return events;
}

/** A replay's step: 400 ms a line, quicker for a long session so it plays in about half a minute. */
const stepMs = (n) => Math.max(40, Math.min(400, 30_000 / n));

/**
 * Where the timeline stands in `n` lines: `pos` null at the end, following
 * the lines as they come (a past session opens there), else how many are
 * drawn. Playing moves one line per step and stops at the end, following again. Back to the
 * end whenever the session changes (`key`).
 */
function useTimeline(n, key) {
  const [pos, setPos] = useState(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setPos(null);
    setPlaying(false);
  }, [key]);
  useEffect(() => {
    if (!playing) return undefined;
    if (pos == null) {
      setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setPos(pos + 1 >= n ? null : pos + 1), stepMs(n));
    return () => clearTimeout(t);
  }, [playing, pos, n]);
  return { pos, setPos, playing, setPlaying };
}

function Timeline({ events, t }) {
  const n = events.length;
  const at = t.pos ?? n;
  return (
    <div className="timeline">
      <button
        type="button"
        disabled={n === 0}
        onClick={() => {
          if (t.playing) return t.setPlaying(false);
          if (t.pos == null) t.setPos(1);
          t.setPlaying(true);
        }}
      >
        {t.playing ? w.pause : w.play}
      </button>
      <input
        type="range"
        min={n === 0 ? 0 : 1}
        max={n}
        value={at}
        disabled={n === 0}
        aria-label={w.step(at, n)}
        onChange={(e) => {
          const v = Number(e.target.value);
          t.setPlaying(false);
          t.setPos(v >= n ? null : v);
        }}
      />
      <span className="at">
        {n ? `${time(events[at - 1]?.time)} · ${w.step(at, n)}` : ""}
      </span>
    </div>
  );
}

function useNow(ms) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const time = (t) => (t ? new Date(t).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const repoName = (key) => key.replace(/-[0-9a-f]{8}$/u, "");
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
/** A start as the list shows it: the time today, the day and time before. */
const when = (t) =>
  !t ? "" : sameDay(t, Date.now()) ? time(t) : new Date(t).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const live = (x) => x.state !== "done";
const byLive = (a, b) => live(b) - live(a) || b.updatedAt - a.updatedAt;

/** The sessions by repository: repositories with a live session first, then the latest; in each, live ones first. */
function groups(sessions) {
  const by = new Map();
  for (const x of sessions) {
    if (!by.has(x.repo)) by.set(x.repo, []);
    by.get(x.repo).push(x);
  }
  const out = [...by].map(([repo, list]) => ({ repo, list: list.sort(byLive) }));
  return out.sort((a, b) => byLive(a.list[0], b.list[0]));
}

function Sessions({ sessions, chosen, pick }) {
  const key = (x) => `${x.repo}/${x.session}`;
  return (
    <nav className="sessions">
      <h2>{w.sessions}</h2>
      {groups(sessions).map((g) => (
        <section key={g.repo}>
          <h3>{repoName(g.repo)}</h3>
          <ul>
            {g.list.map((x) => (
              <li key={key(x)}>
                <button type="button" className={chosen && key(chosen) === key(x) ? "chosen" : ""} onClick={() => pick(x)}>
                  <span className="top">
                    <span className="start">{when(x.startedAt ?? x.updatedAt)}</span>
                    {x.name && x.name !== repoName(g.repo) ? <span className="checkout">{x.name}</span> : null}
                  </span>
                  <span className={`state ${x.state}`}>
                    <span className="dot" />
                    {w.state[x.state]}
                  </span>
                  <span className="tasks">{x.tasks ? w.tasks(x.tasks) : w.noTasks}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** Claude on top, tasks in a row under it, each task's helpers stacked under it. */
function layout(s, selected) {
  const W = 240;
  const GAP = 30;
  const nodes = [];
  const edges = [];
  const columns = s.tasks.filter((t) => t.status !== "deleted").map((t) => ({ id: taskNode(t.id), task: t }));
  if (s.free.actions.length > 0 || columns.length === 0) columns.unshift({ id: FREE, task: null });
  const loose = s.helpers.filter((h) => h.task == null || !columns.some((c) => c.task?.id === h.task));
  const width = columns.length * (W + GAP) - GAP;
  nodes.push({ id: "claude", position: { x: width / 2 - W / 2, y: 0 }, data: { label: <Card kind="claude" title={w.claude} sub={w.state[s.state]} /> }, className: "n claude", selectable: false, style: { width: W } });
  columns.forEach((c, i) => {
    const x = i * (W + GAP);
    const t = c.task;
    const current = t ? s.current === t.id : s.current == null;
    nodes.push({
      id: c.id,
      position: { x, y: 120 },
      data: { label: <Card kind="task" title={t ? t.subject ?? "…" : w.free} sub={t ? w.status[t.status] ?? t.status : ""} count={(t ?? s.free).actions.length} /> },
      className: `n task ${current ? "current" : ""} ${t?.status ?? ""} ${selected === c.id ? "selected" : ""}`,
      style: { width: W },
    });
    edges.push({ id: `e-${c.id}`, source: "claude", target: c.id, animated: current && s.state === "working" });
    const mine = s.helpers.filter((h) => h.task != null && h.task === t?.id).concat(c.id === FREE ? loose : []);
    mine.forEach((h, j) => {
      const id = helperNode(h.id);
      nodes.push({
        id,
        position: { x: x + 16, y: 250 + j * 110 },
        data: { label: <Card kind="helper" title={h.type ? w.helperNamed(h.type) : w.helperAnon} sub={errand(h, lang) ?? w.noErrand} state={w.helper[h.status]} count={h.actions.length} /> },
        className: `n helper ${h.status} ${selected === id ? "selected" : ""}`,
        style: { width: W - 32 },
      });
      edges.push({ id: `e-${id}`, source: c.id, target: id, animated: h.status === "working" });
    });
  });
  return { nodes, edges };
}

const FIT = { padding: 0.2, maxZoom: 1 };

/**
 * Fits the graph again when a node comes or goes, unless the observer has
 * moved the view by hand. React Flow holds the fit until every node is
 * measured, and fits only measured nodes: `useSizes` keeps them measured.
 */
function Fit({ ids, manual }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!manual) fitView(FIT);
  }, [ids, manual, fitView]);
  return null;
}

/**
 * The size React Flow measured for each node, given back with every render.
 * The nodes are rebuilt from the reducer on each event; a node handed over
 * without `measured` is a new, unmeasured node to React Flow, hidden until
 * measured again and left out of a fit, which framed only part of the graph.
 */
function useSizes() {
  const [sizes, setSizes] = useState(() => new Map());
  const onNodesChange = useCallback((changes) => {
    const dims = changes.filter((c) => c.type === "dimensions" && c.dimensions);
    if (dims.length === 0) return;
    setSizes((old) => {
      const next = new Map(old);
      for (const c of dims) next.set(c.id, c.dimensions);
      return next;
    });
  }, []);
  return [sizes, onNodesChange];
}

function Card({ kind, title, sub, state, count }) {
  return (
    <div className={`card ${kind}`}>
      <div className="title">{title}</div>
      {sub ? <div className="sub">{sub}</div> : null}
      {state || count ? (
        <div className="meta">
          {state ?? ""}
          {count ? <span className="count">{count}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function feedOf(s, id) {
  if (id === FREE) return { title: w.free, actions: s.free.actions };
  if (id.startsWith("task:")) {
    const t = s.tasks.find((x) => taskNode(x.id) === id);
    return t && { title: t.subject ?? "…", actions: t.actions };
  }
  const h = s.helpers.find((x) => helperNode(x.id) === id);
  return h && { title: errand(h, lang) ?? (h.type ? w.helperNamed(h.type) : w.helperAnon), actions: h.actions };
}

function Feed({ s, id }) {
  const feed = (id && feedOf(s, id)) ?? feedOf(s, FREE);
  return (
    <aside className="feed">
      <h2>{feed.title}</h2>
      {feed.actions.length === 0 ? <p className="empty">{w.empty}</p> : null}
      <ol>
        {[...feed.actions].reverse().map((a, i) => {
          const p = phrase(a, lang);
          return (
            <li key={a.id ?? i} className={p.tone}>
              <span className="dot" />
              <div>
                <div className="text">{p.text}</div>
                <div className="when">{time(a.time)}</div>
                {p.detail ? (
                  <details>
                    <summary>{w.detail}</summary>
                    <pre>{p.detail}</pre>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function App() {
  const [sessions, lost] = useSessions();
  const asked = params.get("repo") && params.get("session") ? { repo: params.get("repo"), session: params.get("session") } : null;
  const [picked, setPicked] = useState(asked);
  // With no session picked, the page follows the newest one.
  const chosen = picked ?? (sessions?.[0] ? { repo: sessions[0].repo, session: sessions[0].session } : null);
  const events = useEvents(chosen);
  const now = useNow(10_000);
  const t = useTimeline(events.length, chosen ? `${chosen.repo}/${chosen.session}` : "");
  // A point on the timeline is judged by its lines alone, as the live page judged it then.
  const s = useMemo(() => (t.pos == null ? reduce(events, { now }) : reduce(events.slice(0, t.pos))), [events, now, t.pos]);
  const [selected, setSelected] = useState(null);
  const shown = selected ?? s.active;
  const laid = useMemo(() => layout(s, shown), [s, shown]);
  const [sizes, onNodesChange] = useSizes();
  const nodes = useMemo(() => laid.nodes.map((n) => (sizes.has(n.id) ? { ...n, measured: sizes.get(n.id) } : n)), [laid, sizes]);
  const edges = laid.edges;
  const ids = nodes.map((n) => n.id).join(" ");
  // Panned or zoomed by hand: the view stays put until the observer follows again.
  const [manual, setManual] = useState(false);

  return (
    <div className="page">
      <header>
        <span className={`state ${chosen ? s.state : "none"}`}>
          <span className="dot" />
          {chosen ? w.state[s.state] : w.waiting}
        </span>
        {s.repo ? <span className="repo">{s.repo}</span> : null}
        {lost ? <span className="lost">{w.lost}</span> : null}
        <span className="spacer" />
        {selected || manual || t.pos != null ? (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setManual(false);
              t.setPlaying(false);
              t.setPos(null);
            }}
          >
            {w.follow}
          </button>
        ) : null}
      </header>
      <main>
        {/* Drawn before the list arrives: the graph's width must not change under its first fit. */}
        <Sessions
          sessions={sessions ?? []}
          chosen={chosen}
          pick={(x) => {
            setPicked({ repo: x.repo, session: x.session });
            setSelected(null);
            setManual(false);
          }}
        />
        <div className="stage">
          <div className="graph">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              fitViewOptions={FIT}
              onNodesChange={onNodesChange}
              onMove={(e) => e && setManual(true)}
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_, n) => n.id !== "claude" && setSelected(n.id)}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Fit ids={ids} manual={manual} />
            </ReactFlow>
          </div>
          {/* Drawn with no lines too: the graph's height must not change under its first fit. */}
          <Timeline events={events} t={t} />
        </div>
        <Feed s={s} id={shown} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
