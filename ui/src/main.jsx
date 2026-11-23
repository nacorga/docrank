/**
 * The watch page: the session's state in plain words, a graph of Claude, its
 * tasks and its helpers, and the feed of the selected node. Every view comes
 * from `reduce` over the session's lines, as the server streams them.
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
  const s = useMemo(() => reduce(events, { now }), [events, now]);
  const [selected, setSelected] = useState(null);
  const shown = selected ?? s.active;
  const laid = useMemo(() => layout(s, shown), [s, shown]);
  const [sizes, onNodesChange] = useSizes();
  const nodes = useMemo(() => laid.nodes.map((n) => (sizes.has(n.id) ? { ...n, measured: sizes.get(n.id) } : n)), [laid, sizes]);
  const edges = laid.edges;
  const ids = nodes.map((n) => n.id).join(" ");
  // Panned or zoomed by hand: the view stays put until the observer follows again.
  const [manual, setManual] = useState(false);
  const key = (x) => `${x.repo}/${x.session}`;

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
        {selected || manual ? (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setManual(false);
            }}
          >
            {w.follow}
          </button>
        ) : null}
        {sessions?.length ? (
          <label>
            {w.session}{" "}
            <select value={chosen ? key(chosen) : ""} onChange={(e) => setPicked(sessions.find((x) => key(x) === e.target.value) ?? null)}>
              {sessions.map((x) => (
                <option key={key(x)} value={key(x)}>
                  {x.name ?? repoName(x.repo)} · {time(x.updatedAt)} · {x.session.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      <main>
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
        <Feed s={s} id={shown} />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
