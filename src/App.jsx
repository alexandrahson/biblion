import { useState, useEffect, useRef } from "react";

// ─── Dark Academia Palette ──────────────────────────────────────────
const C = {
  bg:        "#1C1612",
  bgCard:    "#261E18",
  bgSurface: "#322820",
  bgInset:   "#1A1410",
  accent:    "#5F9EA0",
  accentSoft:"rgba(95,158,160,0.12)",
  rose:      "#C4868B",
  roseSoft:  "rgba(196,134,139,0.12)",
  roseGlow:  "rgba(196,134,139,0.06)",
  gold:      "#B89A6A",
  goldSoft:  "rgba(184,154,106,0.1)",
  text:      "#E8DDD0",
  textMid:   "#A99484",
  textDim:   "#6E5D50",
  border:    "rgba(184,154,106,0.1)",
  borderHover:"rgba(184,154,106,0.22)",
};

// ─── Storage helpers (localStorage for standalone) ──────────────────
const store = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del: (key) => { try { localStorage.removeItem(key); } catch {} },
};

function extractTextFromPdfBytes(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const streams = [];
  let idx = 0;
  while (true) {
    const start = text.indexOf("stream\n", idx);
    if (start === -1) break;
    const end = text.indexOf("endstream", start);
    if (end === -1) break;
    const chunk = text.slice(start + 7, end);
    const readable = chunk.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
    if (readable.length > 50) streams.push(readable);
    idx = end + 9;
  }
  const parenthetical = [];
  const tjRegex = /\(([^)]{2,})\)/g;
  let match;
  while ((match = tjRegex.exec(text)) !== null) {
    const clean = match[1].replace(/\\/g, "").trim();
    if (clean.length > 1) parenthetical.push(clean);
  }
  const combined = parenthetical.length > streams.length ? parenthetical.join(" ") : streams.join("\n");
  return combined.slice(0, 80000);
}

async function extractTextFromEpub(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const fullText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return fullText.replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#\d+;/g, " ")
      .replace(/[^\x20-\x7E\n\r\t.,!?;:'"()\-\u2014\u2013]/g, " ").replace(/\s+/g, " ").trim()
      .slice(0, 80000);
  } catch { return "Could not parse EPUB."; }
}

async function askAI(systemPrompt, userPrompt, apiKey) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, userPrompt, apiKey }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

const IconBook = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>);
const IconVocab = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>);
const IconSettings = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>);
const IconPlus = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);
const IconSearch = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);
const IconClose = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);

const Spinner = () => (
  <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
    <div style={{ width: 28, height: 28, border: `2px solid ${C.bgSurface}`, borderTop: `2px solid ${C.accent}`, borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
  </div>
);

const BookSpines = () => (
  <div style={{ display: "flex", justifyContent: "center", gap: 3, marginBottom: 24, opacity: 0.5 }}>
    {[{ w: 14, h: 64, bg: C.rose },{ w: 18, h: 72, bg: C.gold },{ w: 12, h: 58, bg: C.accent },{ w: 16, h: 68, bg: "#8B6B5A" },{ w: 20, h: 74, bg: C.rose },{ w: 13, h: 62, bg: "#5A4A3E" },{ w: 17, h: 70, bg: C.accent },{ w: 15, h: 66, bg: C.gold }].map((s, i) => (
      <div key={i} style={{ width: s.w, height: s.h, background: s.bg, borderRadius: 2, alignSelf: "flex-end", opacity: 0.6 + i * 0.05, boxShadow: "inset -1px 0 2px rgba(0,0,0,0.3)" }} />
    ))}
  </div>
);

// ═══════════════════ MAIN APP ═══════════════════════════════════════
export default function BiblionApp() {
  const [tab, setTab] = useState("books");
  const [books, setBooks] = useState([]);
  const [dictionary, setDictionary] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentWord, setCurrentWord] = useState(null);
  const [vocabHistory, setVocabHistory] = useState([]);
  const [lastWordTime, setLastWordTime] = useState(0);
  const [insightType, setInsightType] = useState("key_idea");
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const fileInputRef = useRef(null);
  const dictInputRef = useRef(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [googleShelves, setGoogleShelves] = useState([]);
  const [loadingShelves, setLoadingShelves] = useState(false);
  const [selectedShelf, setSelectedShelf] = useState(null);
  const [shelfVolumes, setShelfVolumes] = useState([]);
  const [loadingVolumes, setLoadingVolumes] = useState(false);
  const [volumesError, setVolumesError] = useState(null);
  const [showMyLibrary, setShowMyLibrary] = useState(false);

  // ── Load from localStorage + handle OAuth redirect ──
  useEffect(() => {
    const b = store.get("biblion-books"); if (b) setBooks(b);
    const d = store.get("biblion-dict"); if (d) setDictionary(d);
    const v = store.get("biblion-vocab-history"); if (v) setVocabHistory(v);
    const cw = store.get("biblion-current-word"); if (cw) setCurrentWord(cw);
    const lt = store.get("biblion-last-word-time"); if (lt) setLastWordTime(lt);
    const k = store.get("biblion-api-key"); if (k) setApiKey(k);
    const gc = store.get("biblion-google-client-id"); if (gc) setGoogleClientId(gc);
    // Handle Google OAuth redirect (implicit flow — token in URL hash)
    const hash = window.location.hash;
    if (hash.includes("access_token=")) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("access_token");
      if (token) {
        setGoogleAccessToken(token);
        store.set("biblion-google-token", token);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      const savedToken = store.get("biblion-google-token");
      if (savedToken) setGoogleAccessToken(savedToken);
    }
  }, []);

  const persist = (key, val) => store.set(key, val);

  const handleBookUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      const ab = await file.arrayBuffer();
      const text = file.name.toLowerCase().endsWith(".epub") ? await extractTextFromEpub(ab) : extractTextFromPdfBytes(ab);
      const nb = { id: Date.now().toString(), title: file.name.replace(/\.(epub|pdf)$/i, "").replace(/[_-]+/g, " "), fileName: file.name, textPreview: text.slice(0, 500), textContent: text, addedAt: new Date().toISOString(), insightCount: 0 };
      const u = [...books, nb]; setBooks(u); persist("biblion-books", u);
    } catch (err) { alert("Error: " + err.message); }
    setLoading(false); e.target.value = "";
  };

  const handleDictUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const words = text.split("\n").map(l => l.trim()).filter(Boolean).map(line => { const p = line.split(/[:\t|]+/); return { word: p[0]?.trim() || line, definition: p.slice(1).join(": ").trim() || "" }; });
      setDictionary(words); persist("biblion-dict", words);
    } catch (err) { alert("Error: " + err.message); }
    setLoading(false); e.target.value = "";
  };

  const ensureApiKey = () => {
    if (apiKey) return true;
    setShowKeyInput(true);
    setTab("settings");
    return false;
  };

  const generateInsight = async (book, type) => {
    if (!ensureApiKey()) return;
    setLoading(true); setInsight(null);
    const labels = { key_idea: "a key idea or concept", quote: "a powerful passage", practical: "a practical takeaway", surprise: "a surprising point", connection: "a connection to broader themes" };
    try {
      const sys = `You are Biblion, a literary curator in a dusty, candlelit bookshop. Extract bite-sized, memorable insights with warmth and erudition. Respond ONLY in JSON: {"title":"","body":"","page_hint":"","reflection":""}`;
      const usr = `Extract ${labels[type]} from this book. Be specific, warm, concise.\n\nBook: "${book.title}"\nText:\n${book.textContent.slice(0, 12000)}`;
      const raw = await askAI(sys, usr, apiKey);
      setInsight(JSON.parse(raw.replace(/```json|```/g, "").trim()));
      const u = books.map(b => b.id === book.id ? { ...b, insightCount: b.insightCount + 1 } : b);
      setBooks(u); persist("biblion-books", u);
    } catch (err) { setInsight({ title: "Error", body: err.message, page_hint: "", reflection: "" }); }
    setLoading(false);
  };

  const getNewWord = async () => {
    if (!dictionary.length) return;
    if (!ensureApiKey()) return;
    setLoading(true);
    const used = vocabHistory.map(v => v.word);
    const pool = dictionary.filter(w => !used.includes(w.word));
    const src = pool.length > 0 ? pool : dictionary;
    const pick = src[Math.floor(Math.random() * src.length)];
    try {
      const sys = `You are a well-read bookseller teaching a new word. Warm, literary. Respond ONLY in JSON: {"word":"","pronunciation":"","partOfSpeech":"","definition":"","etymology":"","example":"","mnemonic":""}`;
      const usr = `Teach me: "${pick.word}"${pick.definition ? ` (${pick.definition})` : ""}`;
      const raw = await askAI(sys, usr, apiKey);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setCurrentWord(parsed); persist("biblion-current-word", parsed);
      const now = Date.now(); setLastWordTime(now); persist("biblion-last-word-time", now);
      const hist = [{ ...parsed, learnedAt: new Date().toISOString() }, ...vocabHistory].slice(0, 100);
      setVocabHistory(hist); persist("biblion-vocab-history", hist);
    } catch (err) { setCurrentWord({ word: pick.word, definition: pick.definition || "", pronunciation: "", partOfSpeech: "", etymology: "", example: "", mnemonic: err.message }); }
    setLoading(false);
  };

  const timeSince = Date.now() - lastWordTime;
  const THREE_HR = 3 * 60 * 60 * 1000;
  const wordReady = timeSince >= THREE_HR;
  const minsLeft = Math.ceil(Math.max(0, THREE_HR - timeSince) / 60000);
  const hrsLeft = Math.floor(minsLeft / 60);
  const minsRem = minsLeft % 60;

  const deleteBook = async (id) => { const u = books.filter(b => b.id !== id); setBooks(u); persist("biblion-books", u); if (selectedBook?.id === id) setSelectedBook(null); };

  const searchGoogleBooks = async (query) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12&printType=books`);
      const data = await res.json();
      setSearchResults(data.items || []);
    } catch (err) {
      alert("Search failed: " + err.message);
    }
    setSearching(false);
  };

  const connectGoogleBooks = () => {
    if (!googleClientId.trim()) return;
    const redirectUri = window.location.origin + window.location.pathname;
    const scope = "https://www.googleapis.com/auth/books";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}`;
    window.location.href = url;
  };

  const disconnectGoogleBooks = () => {
    setGoogleAccessToken(""); setGoogleShelves([]); setSelectedShelf(null); setShelfVolumes([]);
    store.del("biblion-google-token");
  };

  const fetchGoogleShelves = async (token) => {
    setLoadingShelves(true); setGoogleShelves([]);
    try {
      const res = await fetch("https://www.googleapis.com/books/v1/mylibrary/bookshelves", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { disconnectGoogleBooks(); alert("Session expired — please reconnect in Settings."); setLoadingShelves(false); return; }
      const data = await res.json();
      setGoogleShelves(data.items || []);
    } catch (err) { alert("Could not load shelves: " + err.message); }
    setLoadingShelves(false);
  };

  const fetchShelfVolumes = async (shelfId, token) => {
    setSelectedShelf(shelfId); setShelfVolumes([]); setVolumesError(null); setLoadingVolumes(true);
    try {
      const res = await fetch(
        `https://www.googleapis.com/books/v1/mylibrary/bookshelves/${shelfId}/volumes?maxResults=40`,
        { headers: { Authorization: `Bearer ${token || googleAccessToken}` } }
      );
      if (res.status === 401) { disconnectGoogleBooks(); setVolumesError("Session expired — please reconnect in Settings."); setLoadingVolumes(false); return; }
      const data = await res.json();
      if (data.error) { setVolumesError(data.error.message); setLoadingVolumes(false); return; }
      setShelfVolumes(data.items || []);
    } catch (err) { setVolumesError(err.message); }
    setLoadingVolumes(false);
  };

  const addFromGoogleBooks = (item) => {
    const info = item.volumeInfo;
    const parts = [
      `Title: ${info.title || "Unknown"}`,
      info.authors ? `Author(s): ${info.authors.join(", ")}` : "",
      info.publishedDate ? `Published: ${info.publishedDate}` : "",
      info.categories ? `Categories: ${info.categories.join(", ")}` : "",
      info.description ? `\nDescription:\n${info.description}` : "",
    ].filter(Boolean);
    const textContent = parts.join("\n");
    const nb = {
      id: Date.now().toString(),
      title: info.title || "Unknown Title",
      author: info.authors?.join(", ") || "",
      fileName: "",
      textPreview: info.description?.slice(0, 500) || "No description available.",
      textContent,
      addedAt: new Date().toISOString(),
      insightCount: 0,
      coverUrl: info.imageLinks?.thumbnail?.replace("http://", "https://") || null,
      source: "google-books",
    };
    const u = [...books, nb];
    setBooks(u);
    persist("biblion-books", u);
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  const spineColor = (title) => {
    const colors = [C.rose, C.accent, C.gold, "#8B6B5A", "#7A6858", "#6B8A8C", "#A07868"];
    let h = 0; for (let i = 0; i < title.length; i++) h = title.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Cormorant Garamond', 'Georgia', serif", maxWidth: 480, margin: "0 auto", position: "relative", paddingBottom: 84 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes gentlePulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
        .fade-up { animation: fadeUp 0.45s ease-out; }
        .card { background: ${C.bgCard}; border-radius: 12px; padding: 18px; border: 1px solid ${C.border}; transition: transform 0.15s ease, border-color 0.25s ease, box-shadow 0.25s ease; position: relative; }
        .card::after { content: ''; position: absolute; inset: 0; border-radius: 12px; pointer-events: none; background: linear-gradient(135deg, rgba(184,154,106,0.03) 0%, transparent 60%); }
        .card:active { transform: scale(0.98); }
        .card:hover { border-color: ${C.borderHover}; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
        .btn-primary { background: linear-gradient(135deg, ${C.accent} 0%, #4D8A8C 100%); color: #fff; border: none; border-radius: 10px; padding: 13px 20px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 15px; letter-spacing: 0.3px; cursor: pointer; width: 100%; transition: all 0.15s ease; box-shadow: 0 2px 12px rgba(95,158,160,0.2); }
        .btn-primary:active { transform: scale(0.97); }
        .btn-primary:disabled { opacity: 0.35; cursor: default; box-shadow: none; }
        .btn-rose { background: linear-gradient(135deg, ${C.rose} 0%, #A86E73 100%); color: #fff; border: none; border-radius: 10px; padding: 13px 20px; font-family: 'Cormorant Garamond', serif; font-weight: 600; font-size: 15px; cursor: pointer; width: 100%; transition: all 0.15s ease; box-shadow: 0 2px 12px rgba(196,134,139,0.2); }
        .btn-rose:active { transform: scale(0.97); }
        .btn-rose:disabled { opacity: 0.35; cursor: default; box-shadow: none; }
        .btn-ghost { background: transparent; color: ${C.textMid}; border: 1px solid ${C.border}; border-radius: 8px; padding: 9px 16px; font-family: 'Cormorant Garamond', serif; font-size: 14px; cursor: pointer; transition: all 0.15s ease; }
        .btn-ghost:active { background: ${C.bgSurface}; }
        .chip { display: inline-block; padding: 7px 16px; border-radius: 20px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid ${C.border}; color: ${C.textMid}; background: transparent; transition: all 0.2s ease; font-family: 'Cormorant Garamond', serif; }
        .chip.active { background: ${C.accent}; color: #fff; border-color: ${C.accent}; }
        .tab-bar { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); max-width: 480px; width: 100%; background: linear-gradient(180deg, rgba(28,22,18,0.9) 0%, rgba(28,22,18,0.98) 100%); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border-top: 1px solid ${C.border}; display: flex; justify-content: space-around; padding: 8px 0 28px; z-index: 100; }
        .tab-item { display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; color: ${C.textDim}; cursor: pointer; font-family: 'Cormorant Garamond', serif; font-size: 11px; font-weight: 500; padding: 6px 20px; transition: color 0.2s ease; position: relative; }
        .tab-item.active { color: ${C.rose}; }
        .insight-card { background: linear-gradient(145deg, ${C.bgCard} 0%, #2A201A 50%, ${C.bgCard} 100%); border: 1px solid ${C.borderHover}; border-radius: 16px; padding: 24px; position: relative; overflow: hidden; }
        .insight-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${C.accent}, ${C.rose}, ${C.gold}); opacity: 0.6; }
        .insight-card::after { content: ''; position: absolute; top: -60px; right: -60px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, ${C.roseSoft} 0%, transparent 70%); pointer-events: none; }
        .vocab-card { background: linear-gradient(145deg, #2A201A 0%, ${C.bgCard} 100%); border: 1px solid rgba(95,158,160,0.2); border-radius: 16px; padding: 24px; position: relative; overflow: hidden; }
        .vocab-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${C.accent}, ${C.gold}); opacity: 0.5; }
        .vocab-card::after { content: ''; position: absolute; bottom: -40px; left: -40px; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, ${C.accentSoft} 0%, transparent 70%); pointer-events: none; }
        .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
        .serif-body { font-family: 'Libre Baskerville', 'Georgia', serif; }
        .divider { height: 1px; background: ${C.border}; margin: 16px 0; }
        .divider-ornament { text-align: center; color: ${C.textDim}; font-size: 14px; margin: 20px 0; letter-spacing: 8px; }
        input[type="file"] { display: none; }
        .book-spine { width: 6px; border-radius: 2px; flex-shrink: 0; box-shadow: inset -1px 0 2px rgba(0,0,0,0.3); }
        .api-input { width: 100%; padding: 12px 14px; background: ${C.bgInset}; border: 1px solid ${C.border}; border-radius: 8px; color: ${C.text}; font-family: 'JetBrains Mono', monospace; font-size: 13px; outline: none; }
        .api-input:focus { border-color: ${C.accent}; }
        .api-input::placeholder { color: ${C.textDim}; }
        .search-input { width: 100%; padding: 11px 14px; background: ${C.bgInset}; border: 1px solid ${C.border}; border-radius: 8px; color: ${C.text}; font-family: 'Cormorant Garamond', serif; font-size: 15px; outline: none; }
        .search-input:focus { border-color: ${C.accent}; }
        .search-input::placeholder { color: ${C.textDim}; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "24px 22px 12px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "3px", color: C.text, textTransform: "uppercase", fontFamily: "'Libre Baskerville', serif" }}>Biblion</div>
          <div style={{ fontSize: 12, color: C.textDim, fontWeight: 400, marginTop: 2, letterSpacing: "3px", textTransform: "uppercase", fontFamily: "'Libre Baskerville', serif" }}>
            {tab === "books" ? "The Stacks" : tab === "vocab" ? "Word Alcove" : "Bookshop Notes"}
          </div>
        </div>
        {tab === "books" && (
          <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center" }}>
            {googleAccessToken && (
              <button onClick={() => { setShowMyLibrary(s => !s); setShowSearch(false); setSelectedShelf(null); setShelfVolumes([]); }} style={{ height: 38, borderRadius: 10, background: showMyLibrary ? C.bgSurface : "transparent", color: showMyLibrary ? C.gold : C.textMid, border: `1px solid ${showMyLibrary ? C.gold : C.border}`, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: "0 12px", fontSize: 12, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, transition: "all 0.2s", whiteSpace: "nowrap" }}>
                {showMyLibrary ? <IconClose /> : <span style={{ fontSize: 14 }}>G</span>} {showMyLibrary ? "" : "My Library"}
              </button>
            )}
            <button onClick={() => { setShowSearch(s => !s); setShowMyLibrary(false); setSearchResults([]); setSearchQuery(""); }} style={{ width: 38, height: 38, borderRadius: 10, background: showSearch ? C.bgSurface : "transparent", color: showSearch ? C.accent : C.textMid, border: `1px solid ${showSearch ? C.accent : C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
              {showSearch ? <IconClose /> : <IconSearch />}
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${C.rose}, #A86E73)`, color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 10px rgba(196,134,139,0.25)" }}>
              <IconPlus />
            </button>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept=".epub,.pdf" onChange={handleBookUpload} />
      <input ref={dictInputRef} type="file" accept=".txt,.csv,.tsv" onChange={handleDictUpload} />

      <div style={{ padding: "0 22px", position: "relative", zIndex: 1 }}>

        {/* GOOGLE BOOKS SEARCH PANEL */}
        {tab === "books" && !selectedBook && showSearch && (
          <div className="fade-up" style={{ paddingTop: 14, marginBottom: 4 }}>
            <form onSubmit={e => { e.preventDefault(); searchGoogleBooks(searchQuery); }} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input
                className="search-input"
                type="text"
                placeholder="Search by title or author…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              <button type="submit" className="btn-primary" disabled={searching || !searchQuery.trim()} style={{ width: "auto", padding: "0 18px", flexShrink: 0, fontSize: 14 }}>
                {searching ? "…" : "Search"}
              </button>
            </form>
            {searching && <Spinner />}
            {!searching && searchResults.length === 0 && searchQuery && (
              <div style={{ textAlign: "center", padding: "24px 0", color: C.textDim, fontSize: 14, fontStyle: "italic" }}>No results found</div>
            )}
            {searchResults.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
                {searchResults.map(item => {
                  const info = item.volumeInfo;
                  const cover = info.imageLinks?.thumbnail?.replace("http://", "https://");
                  const alreadyAdded = books.some(b => b.title === info.title && b.author === info.authors?.join(", "));
                  return (
                    <div key={item.id} className="card" style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                      {cover ? (
                        <img src={cover} alt="" style={{ width: 46, height: 66, objectFit: "cover", borderRadius: 4, flexShrink: 0, opacity: 0.9 }} />
                      ) : (
                        <div style={{ width: 46, height: 66, background: C.bgSurface, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <IconBook />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>{info.title}</div>
                        {info.authors && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 4 }}>{info.authors.join(", ")}</div>}
                        {info.description && <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} className="serif-body">{info.description}</div>}
                      </div>
                      <button onClick={() => addFromGoogleBooks(item)} disabled={alreadyAdded} style={{ alignSelf: "center", flexShrink: 0, background: alreadyAdded ? "transparent" : `linear-gradient(135deg, ${C.accent}, #4D8A8C)`, color: alreadyAdded ? C.textDim : "#fff", border: alreadyAdded ? `1px solid ${C.border}` : "none", borderRadius: 8, padding: "7px 12px", cursor: alreadyAdded ? "default" : "pointer", fontSize: 12, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {alreadyAdded ? "Shelved" : "+ Shelve"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ height: 1, background: C.border, margin: "14px 0 0" }} />
          </div>
        )}

        {/* MY GOOGLE LIBRARY PANEL */}
        {tab === "books" && !selectedBook && googleAccessToken && showMyLibrary && (
          <div className="fade-up" style={{ paddingTop: 14, marginBottom: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600, fontStyle: "italic" }}>My Google Library</div>
              <button className="btn-ghost" onClick={() => { setShowMyLibrary(false); setSelectedShelf(null); setShelfVolumes([]); }} style={{ fontSize: 12, padding: "5px 10px" }}>Close</button>
            </div>
            {googleShelves.length === 0 && !loadingShelves && !selectedShelf && (
              <button className="btn-primary" onClick={() => fetchGoogleShelves(googleAccessToken)} style={{ marginBottom: 12 }}>Load My Shelves</button>
            )}
            {loadingShelves && <Spinner />}
            {googleShelves.length > 0 && !selectedShelf && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {googleShelves.map(shelf => (
                  <div key={shelf.id} className="card" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={() => fetchShelfVolumes(shelf.id, googleAccessToken)}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{shelf.title}</div>
                      <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }} className="mono">{shelf.volumeCount} book{shelf.volumeCount !== 1 ? "s" : ""}</div>
                    </div>
                    <span style={{ color: C.textDim, fontSize: 18 }}>›</span>
                  </div>
                ))}
              </div>
            )}
            {selectedShelf !== null && (
              <>
                <button className="btn-ghost" onClick={() => { setSelectedShelf(null); setShelfVolumes([]); setVolumesError(null); }} style={{ marginBottom: 12, fontSize: 12 }}>‹ Shelves</button>
                {loadingVolumes && <Spinner />}
                {volumesError && <div style={{ background: C.bgSurface, borderRadius: 8, padding: 14, fontSize: 13, color: C.rose, lineHeight: 1.6 }} className="serif-body">{volumesError}</div>}
                {!loadingVolumes && !volumesError && shelfVolumes.length === 0 && <div style={{ textAlign: "center", padding: 24, color: C.textDim, fontSize: 14, fontStyle: "italic" }}>This shelf is empty</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {shelfVolumes.map(item => {
                    const info = item.volumeInfo;
                    const cover = info.imageLinks?.thumbnail?.replace("http://", "https://");
                    const alreadyAdded = books.some(b => b.title === info.title && b.author === info.authors?.join(", "));
                    return (
                      <div key={item.id} className="card" style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                        {cover ? (
                          <img src={cover} alt="" style={{ width: 44, height: 62, objectFit: "cover", borderRadius: 4, flexShrink: 0, opacity: 0.9 }} />
                        ) : (
                          <div style={{ width: 44, height: 62, background: C.bgSurface, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><IconBook /></div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>{info.title}</div>
                          {info.authors && <div style={{ fontSize: 12, color: C.textMid }}>{info.authors.join(", ")}</div>}
                        </div>
                        <button onClick={() => addFromGoogleBooks(item)} disabled={alreadyAdded} style={{ alignSelf: "center", flexShrink: 0, background: alreadyAdded ? "transparent" : `linear-gradient(135deg, ${C.accent}, #4D8A8C)`, color: alreadyAdded ? C.textDim : "#fff", border: alreadyAdded ? `1px solid ${C.border}` : "none", borderRadius: 8, padding: "7px 12px", cursor: alreadyAdded ? "default" : "pointer", fontSize: 12, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {alreadyAdded ? "Shelved" : "+ Shelve"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ height: 1, background: C.border, margin: "14px 0 0" }} />
          </div>
        )}

        {/* BOOKS — Empty */}
        {tab === "books" && !selectedBook && (
          <div className="fade-up">
            {books.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 16px" }}>
                <BookSpines />
                <div style={{ fontSize: 21, fontWeight: 500, marginBottom: 8, fontStyle: "italic" }}>The shelves are bare</div>
                <div style={{ fontSize: 14, color: C.textMid, marginBottom: 28, lineHeight: 1.7 }} className="serif-body">Add an EPUB or PDF to begin<br/>your reading journey</div>
                <button className="btn-rose" onClick={() => fileInputRef.current?.click()}>Shelve Your First Book</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 14 }}>
                {books.map(book => (
                  <div key={book.id} className="card" onClick={() => setSelectedBook(book)} style={{ cursor: "pointer", display: "flex", gap: 12, alignItems: "stretch" }}>
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt="" style={{ width: 44, height: 62, objectFit: "cover", borderRadius: 4, flexShrink: 0, opacity: 0.9 }} />
                    ) : (
                      <div className="book-spine" style={{ background: spineColor(book.title), minHeight: 50 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 2, lineHeight: 1.3 }}>{book.title}</div>
                        <button onClick={e => { e.stopPropagation(); deleteBook(book.id); }} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 16, padding: "0 2px", flexShrink: 0 }}>×</button>
                      </div>
                      {book.author && <div style={{ fontSize: 12, color: C.textMid, marginBottom: 2 }}>{book.author}</div>}
                      <div style={{ fontSize: 11, color: C.textDim }} className="mono">{book.insightCount} insight{book.insightCount !== 1 ? "s" : ""} drawn</div>
                      <div style={{ fontSize: 13, color: C.textMid, marginTop: 6, lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }} className="serif-body">{book.textPreview}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BOOK DETAIL */}
        {tab === "books" && selectedBook && (
          <div className="fade-up" style={{ paddingTop: 8 }}>
            <button className="btn-ghost" onClick={() => { setSelectedBook(null); setInsight(null); }} style={{ marginBottom: 18 }}>‹ Back to the Stacks</button>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 4 }}>
              {selectedBook.coverUrl ? (
                <img src={selectedBook.coverUrl} alt="" style={{ width: 54, height: 76, objectFit: "cover", borderRadius: 5, flexShrink: 0, opacity: 0.92 }} />
              ) : (
                <div className="book-spine" style={{ background: spineColor(selectedBook.title), height: 36, alignSelf: "center" }} />
              )}
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{selectedBook.title}</div>
                {selectedBook.author && <div style={{ fontSize: 13, color: C.textMid, marginTop: 4, fontStyle: "italic" }}>{selectedBook.author}</div>}
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 22, paddingLeft: selectedBook.coverUrl ? 68 : 18 }} className="mono">{selectedBook.insightCount} insights · {Math.round(selectedBook.textContent.length / 1000)}k chars</div>
            <div style={{ fontSize: 14, color: C.textMid, marginBottom: 10, fontStyle: "italic" }}>What would you like to discover?</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {[["key_idea","Key Idea"],["quote","Passage"],["practical","Practical"],["surprise","Surprise"],["connection","Connection"]].map(([v,l]) => (
                <span key={v} className={`chip ${insightType === v ? "active" : ""}`} onClick={() => setInsightType(v)}>{l}</span>
              ))}
            </div>
            <button className="btn-primary" onClick={() => generateInsight(selectedBook, insightType)} disabled={loading}>{loading ? "Browsing the pages…" : "Open to a Page"}</button>
            {loading && <Spinner />}
            {insight && !loading && (
              <div className="fade-up" style={{ marginTop: 22 }}>
                <div className="insight-card">
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 11, color: C.rose, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, marginBottom: 14 }} className="mono">From the Pages</div>
                    <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, lineHeight: 1.35 }}>{insight.title}</div>
                    <div style={{ fontSize: 15, color: C.textMid, lineHeight: 1.75, marginBottom: 14 }} className="serif-body">{insight.body}</div>
                    {insight.page_hint && <div style={{ fontSize: 11, color: C.textDim }} className="mono">◆ {insight.page_hint}</div>}
                    {insight.reflection && (<><div className="divider" /><div style={{ fontSize: 14, color: C.gold, fontStyle: "italic", lineHeight: 1.6 }} className="serif-body">{insight.reflection}</div></>)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VOCAB TAB */}
        {tab === "vocab" && (
          <div className="fade-up" style={{ paddingTop: 14 }}>
            {dictionary.length === 0 ? (
              <div style={{ textAlign: "center", padding: "56px 16px" }}>
                <div style={{ fontSize: 36, marginBottom: 16, opacity: 0.3, letterSpacing: 8, fontStyle: "italic" }}>A B C</div>
                <div style={{ fontSize: 21, fontWeight: 500, marginBottom: 8, fontStyle: "italic" }}>No lexicon yet</div>
                <div style={{ fontSize: 14, color: C.textMid, marginBottom: 28, lineHeight: 1.7 }} className="serif-body">Upload a word list to begin.<br/>One word per line, definitions optional.</div>
                <button className="btn-primary" onClick={() => dictInputRef.current?.click()}>Import Your Lexicon</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: C.textDim }} className="mono">{dictionary.length} words · {vocabHistory.length} learned</div>
                  <button className="btn-ghost" onClick={() => dictInputRef.current?.click()} style={{ fontSize: 12, padding: "6px 12px" }}>Replace</button>
                </div>
                {!wordReady && currentWord && (
                  <div style={{ background: C.bgSurface, borderRadius: 12, padding: 14, marginBottom: 16, textAlign: "center", fontSize: 14, color: C.textMid, border: `1px solid ${C.border}` }}>
                    Next word arrives in <span style={{ color: C.accent, fontWeight: 600 }}>{hrsLeft > 0 ? `${hrsLeft}h ${minsRem}m` : `${minsLeft}m`}</span>
                  </div>
                )}
                {(wordReady || !currentWord) && (
                  <button className="btn-primary" onClick={getNewWord} disabled={loading} style={{ marginBottom: 20 }}>
                    {loading ? "Searching the dictionary…" : currentWord ? "Turn Another Page" : "Your First Word Awaits"}
                  </button>
                )}
                {loading && <Spinner />}
                {currentWord && !loading && (
                  <div className="vocab-card fade-up" style={{ marginBottom: 22 }}>
                    <div style={{ position: "relative", zIndex: 1 }}>
                      <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, marginBottom: 14 }} className="mono">Today's Word</div>
                      <div style={{ fontSize: 30, fontWeight: 600, marginBottom: 2, letterSpacing: "0.5px" }}>{currentWord.word}</div>
                      {currentWord.pronunciation && <div style={{ fontSize: 13, color: C.textDim, marginBottom: 2 }} className="mono">{currentWord.pronunciation}</div>}
                      {currentWord.partOfSpeech && <div style={{ fontSize: 13, color: C.rose, fontStyle: "italic", marginBottom: 16 }}>{currentWord.partOfSpeech}</div>}
                      <div style={{ fontSize: 15, lineHeight: 1.7, color: C.text, marginBottom: 16 }} className="serif-body">{currentWord.definition}</div>
                      {currentWord.example && (<><div className="divider" /><div style={{ fontSize: 14, color: C.textMid, fontStyle: "italic", lineHeight: 1.6, marginBottom: 12 }} className="serif-body">"{currentWord.example}"</div></>)}
                      {currentWord.etymology && <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }} className="serif-body"><span style={{ color: C.gold }}>Origin</span> — {currentWord.etymology}</div>}
                      {currentWord.mnemonic && <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, marginTop: 8 }} className="serif-body"><span style={{ color: C.accent }}>Remember</span> — {currentWord.mnemonic}</div>}
                    </div>
                  </div>
                )}
                {vocabHistory.length > 1 && (
                  <>
                    <div className="divider-ornament">· · ·</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: C.textMid, fontStyle: "italic" }}>Words you've collected</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {vocabHistory.slice(1, 11).map((w, i) => (
                        <div key={i} className="card" style={{ padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 16, fontWeight: 600 }}>{w.word}</span>
                            <span style={{ fontSize: 11, color: C.textDim }} className="mono">{w.partOfSpeech}</span>
                          </div>
                          <div style={{ fontSize: 13, color: C.textMid, marginTop: 4, lineHeight: 1.5 }} className="serif-body">{w.definition}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* SETTINGS */}
        {tab === "settings" && (
          <div className="fade-up" style={{ paddingTop: 14 }}>
            {/* API Key Card */}
            <div className="card" style={{ marginBottom: 12, borderColor: !apiKey ? "rgba(196,134,139,0.3)" : C.border }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, fontStyle: "italic" }}>
                API Key {apiKey ? <span style={{ color: C.accent, fontSize: 12 }}>✓ Set</span> : <span style={{ color: C.rose, fontSize: 12 }}>Required</span>}
              </div>
              <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.7, marginBottom: 12 }} className="serif-body">
                Biblion needs a DeepSeek API key to generate insights and vocabulary. Your key is stored only on this device.
              </div>
              {(showKeyInput || !apiKey) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    className="api-input"
                    type="password"
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <button className="btn-primary" onClick={() => {
                    persist("biblion-api-key", apiKey);
                    setShowKeyInput(false);
                  }} disabled={!apiKey} style={{ fontSize: 14 }}>
                    Save Key
                  </button>
                </div>
              ) : (
                <button className="btn-ghost" onClick={() => setShowKeyInput(true)} style={{ fontSize: 13 }}>
                  Change Key
                </button>
              )}
            </div>

            <div className="card" style={{ marginBottom: 12, borderColor: googleAccessToken ? "rgba(95,158,160,0.3)" : C.border }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, fontStyle: "italic" }}>
                Google Books {googleAccessToken ? <span style={{ color: C.accent, fontSize: 12 }}>✓ Connected</span> : <span style={{ color: C.textDim, fontSize: 12 }}>Not connected</span>}
              </div>
              {googleAccessToken ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.7 }} className="serif-body">Your Google Books account is connected. Browse your shelves from the Books tab.</div>
                  <button className="btn-ghost" onClick={disconnectGoogleBooks} style={{ fontSize: 13, color: "#C46B6B" }}>Disconnect</button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.7, marginBottom: 4 }} className="serif-body">
                    Connect your Google Books account to browse your shelves and import books. You'll need a Google OAuth Client ID — create one free at <span style={{ color: C.accent, fontFamily: "monospace", fontSize: 12 }}>console.cloud.google.com</span>.
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 4 }} className="mono">
                    1. Create a project → Enable "Books API"<br/>
                    2. Credentials → OAuth 2.0 Client ID (Web)<br/>
                    3. Add <span style={{ color: C.accent }}>https://biblion-bvzl.vercel.app</span> as authorized redirect URI
                  </div>
                  <input
                    className="api-input"
                    type="text"
                    placeholder="your-client-id.apps.googleusercontent.com"
                    value={googleClientId}
                    onChange={e => setGoogleClientId(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn-ghost" onClick={() => { persist("biblion-google-client-id", googleClientId); }} disabled={!googleClientId} style={{ fontSize: 13, flex: 1 }}>Save ID</button>
                    <button className="btn-primary" onClick={() => { persist("biblion-google-client-id", googleClientId); connectGoogleBooks(); }} disabled={!googleClientId} style={{ fontSize: 13, flex: 2 }}>Connect with Google</button>
                  </div>
                </div>
              )}
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, fontStyle: "italic" }}>About Biblion</div>
              <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.7 }} className="serif-body">A candlelit corner of the internet where your books yield their secrets, one insight at a time. Powered by DeepSeek.</div>
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, fontStyle: "italic" }}>Dictionary Format</div>
              <div style={{ fontSize: 14, color: C.textMid, lineHeight: 1.7, marginBottom: 12 }} className="serif-body">A plain text file, one word per line. Definitions are optional — separate with a colon or tab.</div>
              <div className="mono" style={{ color: C.textDim, lineHeight: 1.8, padding: "10px 14px", background: C.bgInset, borderRadius: 8 }}>
                ephemeral: lasting briefly<br/>quotidian: daily, ordinary<br/>perspicacious: keenly perceptive
              </div>
            </div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, fontStyle: "italic" }}>Your Collection</div>
              <div style={{ fontSize: 14, color: C.textMid, marginBottom: 14 }} className="serif-body">{books.length} book{books.length !== 1 ? "s" : ""} shelved · {dictionary.length} words in lexicon · {vocabHistory.length} words learned</div>
              <button className="btn-ghost" style={{ fontSize: 13, color: "#C46B6B" }} onClick={() => {
                if (confirm("Clear everything from the shop? This cannot be undone.")) {
                  setBooks([]); setDictionary([]); setVocabHistory([]); setCurrentWord(null); setLastWordTime(0);
                  store.del("biblion-books"); store.del("biblion-dict"); store.del("biblion-vocab-history");
                  store.del("biblion-current-word"); store.del("biblion-last-word-time");
                }
              }}>Clear All Data</button>
            </div>
          </div>
        )}
      </div>

      {/* Tab Bar */}
      <div className="tab-bar">
        {[["books","The Stacks",<IconBook key="b"/>],["vocab","Word Alcove",<IconVocab key="v"/>],["settings","Notes",<IconSettings key="s"/>]].map(([id,label,icon]) => (
          <button key={id} className={`tab-item ${tab === id ? "active" : ""}`} onClick={() => { setTab(id); setSelectedBook(null); setInsight(null); }}>
            {icon}<span>{label}</span>
            {id === "vocab" && wordReady && dictionary.length > 0 && (
              <div style={{ width: 6, height: 6, borderRadius: 3, background: C.accent, position: "absolute", top: 2, right: 16, animation: "gentlePulse 2s ease-in-out infinite" }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
