import { useState, useEffect, useRef, useMemo } from "react";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { loadBooks, putBook, removeBook, clearAllBooks } from "./bookStore";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ─── Palettes ──────────────────────────────────────────────────────
const darkPalette = {
  bg:         "#1C1612",
  bgCard:     "#261E18",
  bgSurface:  "#322820",
  bgInset:    "#1A1410",
  accent:     "#5F9EA0",
  accentSoft: "rgba(95,158,160,0.12)",
  rose:       "#C4868B",
  roseSoft:   "rgba(196,134,139,0.12)",
  roseGlow:   "rgba(196,134,139,0.06)",
  gold:       "#B89A6A",
  goldSoft:   "rgba(184,154,106,0.1)",
  text:       "#E8DDD0",
  textMid:    "#A99484",
  textDim:    "#6E5D50",
  border:     "rgba(184,154,106,0.1)",
  borderHover:"rgba(184,154,106,0.22)",
  tabBarBg:   "linear-gradient(180deg, rgba(28,22,18,0.9) 0%, rgba(28,22,18,0.98) 100%)",
};

const lightPalette = {
  bg:         "#F4EDE5",
  bgCard:     "#EBE1D6",
  bgSurface:  "#E0D3C5",
  bgInset:    "#F8F2EB",
  accent:     "#4A8486",
  accentSoft: "rgba(74,132,134,0.10)",
  rose:       "#B06E73",
  roseSoft:   "rgba(176,110,115,0.10)",
  roseGlow:   "rgba(176,110,115,0.05)",
  gold:       "#8D7345",
  goldSoft:   "rgba(141,115,69,0.10)",
  text:       "#2C221A",
  textMid:    "#6B5B4E",
  textDim:    "#9A8A7C",
  border:     "rgba(141,115,69,0.12)",
  borderHover:"rgba(141,115,69,0.25)",
  tabBarBg:   "linear-gradient(180deg, rgba(244,237,229,0.92) 0%, rgba(244,237,229,0.98) 100%)",
};

let C = darkPalette;

// ─── Storage helpers (localStorage for standalone) ──────────────────
const store = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del: (key) => { try { localStorage.removeItem(key); } catch {} },
};

async function extractTextFromPdfBytes(arrayBuffer) {
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(" ");
      if (text.trim()) pages.push(text);
    }
    return pages.join("\n\n").slice(0, 80000);
  } catch (e) {
    console.error("PDF parse error:", e);
    return "Could not parse PDF.";
  }
}

async function extractTextFromEpub(arrayBuffer) {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const contentFiles = [];
    zip.forEach((path, entry) => {
      if (/\.(xhtml|html|htm)$/i.test(path) && !entry.dir) {
        contentFiles.push(entry);
      }
    });
    contentFiles.sort((a, b) => a.name.localeCompare(b.name));
    const texts = await Promise.all(contentFiles.map(f => f.async("string")));
    return texts.join("\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#\d+;/g, " ")
      .replace(/\s+/g, " ").trim()
      .slice(0, 80000);
  } catch { return "Could not parse EPUB."; }
}

function domNodeToText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  if (["script","style","nav","aside","head"].includes(tag)) return "";
  const inner = [...node.childNodes].map(domNodeToText).join("");
  if (/^h[1-4]$/.test(tag)) return `\n\n## ${inner.trim()}\n\n`;
  if (tag === "p") return `${inner.trim()}\n\n`;
  if (tag === "br") return "\n";
  if (["div","section","article","li"].includes(tag)) return `${inner.trim()}\n`;
  return inner;
}

async function extractEpubChapters(arrayBuffer) {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) return null;
    const containerXml = await containerFile.async("text");
    const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (!opfMatch) return null;
    const opfPath = opfMatch[1];
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const opfFile = zip.file(opfPath);
    if (!opfFile) return null;
    const opfXml = await opfFile.async("text");
    const parser = new DOMParser();
    const opfDoc = parser.parseFromString(opfXml, "text/xml");
    const manifest = {};
    opfDoc.querySelectorAll("manifest item").forEach(item => {
      manifest[item.getAttribute("id")] = item.getAttribute("href");
    });

    // Build TOC label map from NCX (EPUB2) or nav (EPUB3)
    const tocMap = {};
    const ncxItem = opfDoc.querySelector('manifest item[media-type="application/x-dtbncx+xml"]');
    const navItem = opfDoc.querySelector('manifest item[properties~="nav"]');
    if (navItem) {
      const navHref = navItem.getAttribute("href");
      const navFile = zip.file(opfDir + navHref) || zip.file(navHref);
      if (navFile) {
        const navHtml = await navFile.async("text");
        const navDoc = parser.parseFromString(navHtml, "text/html");
        navDoc.querySelectorAll("nav[*|type='toc'] a, nav.toc a, nav#toc a").forEach(a => {
          const href = (a.getAttribute("href") || "").split("#")[0];
          const label = a.textContent.trim();
          if (href && label) tocMap[href] = label;
        });
        if (Object.keys(tocMap).length === 0) {
          navDoc.querySelectorAll("nav a").forEach(a => {
            const href = (a.getAttribute("href") || "").split("#")[0];
            const label = a.textContent.trim();
            if (href && label) tocMap[href] = label;
          });
        }
      }
    }
    if (Object.keys(tocMap).length === 0 && ncxItem) {
      const ncxHref = ncxItem.getAttribute("href");
      const ncxFile = zip.file(opfDir + ncxHref) || zip.file(ncxHref);
      if (ncxFile) {
        const ncxXml = await ncxFile.async("text");
        const ncxDoc = parser.parseFromString(ncxXml, "text/xml");
        ncxDoc.querySelectorAll("navPoint").forEach(np => {
          const label = np.querySelector("navLabel text")?.textContent?.trim();
          const src = (np.querySelector("content")?.getAttribute("src") || "").split("#")[0];
          if (label && src) tocMap[src] = label;
        });
      }
    }

    const spineIds = [...opfDoc.querySelectorAll("spine itemref")].map(r => r.getAttribute("idref"));
    const chapters = [];
    for (const id of spineIds) {
      const href = manifest[id]; if (!href) continue;
      const file = zip.file(opfDir + href) || zip.file(href); if (!file) continue;
      const html = await file.async("text");
      const doc = parser.parseFromString(html, "text/html");
      const tocLabel = tocMap[href];
      const heading = doc.querySelector("h1,h2,h3");
      const headingText = heading?.textContent?.trim();
      const title = tocLabel || headingText || doc.title || "";
      const text = domNodeToText(doc.body || doc.documentElement)
        .replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
      if (text.length > 100) chapters.push({ title, content: text });
    }
    // Deduplicate: if most titles are the same, they're probably the book title
    if (chapters.length > 2) {
      const freq = {};
      chapters.forEach(c => { if (c.title) freq[c.title] = (freq[c.title] || 0) + 1; });
      const maxTitle = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      if (maxTitle && maxTitle[1] > chapters.length * 0.4) {
        const repeatedTitle = maxTitle[0];
        let sectionNum = 1;
        chapters.forEach(c => {
          if (c.title === repeatedTitle) {
            const firstLine = c.content.split("\n").find(l => l.trim().length > 0 && l.trim().length < 80);
            c.title = firstLine?.trim() || `Section ${sectionNum}`;
            sectionNum++;
          }
        });
      }
    }
    // Final fallback for empty titles
    chapters.forEach((c, i) => { if (!c.title) c.title = `Section ${i + 1}`; });
    return chapters.length > 0 ? chapters : null;
  } catch { return null; }
}

function splitIntoPages(text, charsPerPage = 3000) {
  const pages = []; let remaining = text.trim(); let i = 1;
  while (remaining.length > 0) {
    let chunk;
    if (remaining.length <= charsPerPage) { chunk = remaining; remaining = ""; }
    else {
      let cut = remaining.lastIndexOf("\n\n", charsPerPage);
      if (cut < charsPerPage * 0.4) cut = remaining.lastIndexOf(" ", charsPerPage);
      if (cut <= 0) cut = charsPerPage;
      chunk = remaining.slice(0, cut).trim();
      remaining = remaining.slice(cut).trim();
    }
    const firstLine = chunk.split("\n").find(l => l.trim().length > 2 && l.trim().length < 80);
    const title = (firstLine?.trim() && firstLine.trim().length < 60) ? `${i}. ${firstLine.trim()}` : `Page ${i}`;
    pages.push({ title, content: chunk });
    i++;
  }
  return pages;
}

async function askAI(systemPrompt, userPrompt, apiKey) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
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
const IconBookmark = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>);

function splitIntoSentenceChunks(text, minSentences = 1, maxSentences = 4, maxChars = 480) {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const sentences = cleaned.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
  if (!sentences.length) return [];
  const chunks = [];
  let i = 0;
  while (i < sentences.length) {
    const remaining = sentences.length - i;
    let size = 1;
    let len = sentences[i].length;
    while (size < Math.min(maxSentences, remaining)) {
      const next = sentences[i + size].length + 1;
      if (len + next > maxChars && size >= minSentences) break;
      len += next;
      size++;
    }
    if (remaining - size < minSentences && remaining - size > 0 && remaining <= maxSentences) {
      size = remaining;
    }
    chunks.push(sentences.slice(i, i + size).join(" "));
    i += size;
  }
  return chunks;
}

function getChapterChunks(chapters) {
  return (chapters || []).map((chapter, chapterIndex) => ({
    chapterIndex,
    chapterTitle: chapter.title || `Chapter ${chapterIndex + 1}`,
    chunks: splitIntoSentenceChunks(chapter.content).map((content, chunkIndex, arr) => ({
      content,
      chunkIndex,
      chunkLabel: `Chunk ${chunkIndex + 1}/${arr.length}`
    }))
  })).filter(ch => ch.chunks.length > 0);
}

function smartenQuotes(text) {
  let out = "";
  let openDouble = true;
  let openSingle = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1] || "";
    const next = text[i + 1] || "";
    if (ch === '"') {
      out += openDouble ? '“' : '”';
      openDouble = !openDouble;
    } else if (ch === "'") {
      const isApostrophe = /[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next);
      if (isApostrophe) out += '’';
      else {
        out += openSingle ? '‘' : '’';
        openSingle = !openSingle;
      }
    } else out += ch;
  }
  return out;
}

// Render text with tappable words, keeping punctuation visually attached to adjacent words
function renderTappableWords(text, onTap, color) {
  const smart = smartenQuotes(text || "");
  const wordRe = /(\b[A-Za-z][A-Za-z’'-]*\b)/g;
  return smart.split(/(\s+)/).map((token, i) => {
    if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
    const parts = token.split(wordRe);
    if (parts.length <= 1) return <span key={i} style={{ whiteSpace: "nowrap" }}>{token}</span>;
    return (
      <span key={i} style={{ whiteSpace: "nowrap" }}>
        {parts.map((p, j) =>
          /^[A-Za-z][A-Za-z’'-]*$/.test(p)
            ? <button key={j} onClick={() => onTap?.(p.replace(/[’']/g, ""))} style={{ background: "none", border: "none", color, padding: 0, margin: 0, font: "inherit", cursor: "pointer" }}>{p}</button>
            : p ? <span key={j}>{p}</span> : null
        )}
      </span>
    );
  });
}

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

// ═══════════════════ READER VIEW ════════════════════════════════════
function ReaderView({ book, chapterIdx, chapters, chunkIdx, onClose, onChapterChange, onChunkChange, onSaveChunk, savedChunkIds, onWordTap }) {
  const scrollRef = useRef(null);
  const chapter = chapters[chapterIdx];
  const chunk = chapter?.chunks?.[chunkIdx];

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [chapterIdx, chunkIdx]);

  const progress = chapters.length > 0 ? Math.round(((chapterIdx + (chapter?.chunks?.length ? (chunkIdx + 1) / chapter.chunks.length : 0)) / chapters.length) * 100) : 0;
  const chunkId = chapter && chunk ? `${book.id}:${chapter.chapterIndex}:${chunk.chunkIndex}` : null;
  const isSaved = chunkId ? savedChunkIds.includes(chunkId) : false;

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: C.bg, zIndex: 200, display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: C.bgCard }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textMid, cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "2px 6px", flexShrink: 0 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.title}</div>
          <select value={chapterIdx} onChange={e => onChapterChange(+e.target.value)} style={{ fontSize: 14, color: C.text, background: "transparent", border: "none", outline: "none", cursor: "pointer", fontFamily: "'Cormorant Garamond', serif", width: "100%", marginTop: 1 }}>
            {chapters.map((ch, i) => <option key={i} value={i} style={{ background: C.bgCard }}>{ch.chapterTitle}</option>)}
          </select>
        </div>
        <button className="btn-ghost" onClick={() => chunk && onSaveChunk(chapter, chunk)} disabled={!chunk} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "8px 10px", color: isSaved ? C.gold : C.textMid, borderColor: isSaved ? C.gold : C.border }}>
          <IconBookmark /> {isSaved ? "Saved" : "Save"}
        </button>
      </div>
      <div style={{ height: 2, background: C.bgSurface, flexShrink: 0 }}>
        <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg, ${C.accent}, ${C.rose})`, transition: "width 0.3s ease" }} />
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px", WebkitOverflowScrolling: "touch" }}>
        {book.source === "google-books" && !book.hasFullText && (
          <div style={{ background: C.bgSurface, borderRadius: 10, padding: "12px 16px", marginBottom: 24, fontSize: 13, color: C.textMid, lineHeight: 1.6, border: `1px solid ${C.border}` }} className="serif-body">
            Full text unavailable. Upload the EPUB or PDF directly if you want the whole book in chunks.
          </div>
        )}
        {chapter && chunk ? (
          <>
            <div style={{ fontSize: 13, color: C.rose, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>{chapter.chapterTitle}</div>
            <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 20 }}>{chunk.chunkLabel}</div>
            <div style={{ fontSize: 17, color: C.text, lineHeight: 1.7, fontFamily: "’Libre Baskerville’, Georgia, serif", whiteSpace: "pre-wrap" }}>{renderTappableWords(chunk.content, onWordTap, C.text)}</div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: 40, color: C.textDim, fontStyle: "italic" }}>No content available</div>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgCard, flexShrink: 0 }}>
        <button className="btn-ghost" onClick={() => onChunkChange(-1)} disabled={chapterIdx === 0 && chunkIdx === 0} style={{ fontSize: 13, padding: "8px 14px" }}>‹ Prev</button>
        <span style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{chapter ? `${chapter.chapterIndex + 1}/${chapters.length} · ${chunk.chunkIndex + 1}/${chapter.chunks.length}` : `${progress}%`}</span>
        <button className="btn-ghost" onClick={() => onChunkChange(1)} disabled={chapterIdx === chapters.length - 1 && chunkIdx === (chapter?.chunks?.length || 1) - 1} style={{ fontSize: 13, padding: "8px 14px" }}>Next ›</button>
      </div>
    </div>
  );
}

// ═══════════════════ MAIN APP ═══════════════════════════════════════
export default function BiblionApp() {
  const [tab, setTab] = useState(() => store.get("biblion-tab") || "books");
  const [books, setBooks] = useState([]);
  const [dictionary, setDictionary] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentWord, setCurrentWord] = useState(null);
  const [vocabHistory, setVocabHistory] = useState([]);
  const [lastWordTime, setLastWordTime] = useState(0);
  const [savedPassages, setSavedPassages] = useState([]);
  const [readerChunkIdx, setReaderChunkIdx] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiBalanceInfo, setApiBalanceInfo] = useState(null);
  const [checkingApiBalance, setCheckingApiBalance] = useState(false);
  const [apiBalanceError, setApiBalanceError] = useState("");
  const fileInputRef = useRef(null);
  const dictInputRef = useRef(null);
  const [dictSearchQuery, setDictSearchQuery] = useState("");
  const [dictSearchResult, setDictSearchResult] = useState(null);
  const [dictSearching, setDictSearching] = useState(false);
  const [dictSearchError, setDictSearchError] = useState("");
  const [lookupModalWord, setLookupModalWord] = useState("");
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
  const [addingBookId, setAddingBookId] = useState(null);
  const [showMyLibrary, setShowMyLibrary] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [readerBook, setReaderBook] = useState(null);
  const [readerChapterIdx, setReaderChapterIdx] = useState(0);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editDescValue, setEditDescValue] = useState("");
  const backPressRef = useRef({ last: 0 });
  const [theme, setTheme] = useState(() => store.get("biblion-theme") || "dark");

  // Update module-level C on each render so all components see the current palette
  C = theme === "light" ? lightPalette : darkPalette;

  // ── Load from localStorage/IndexedDB + handle OAuth redirect ──
  useEffect(() => {
    loadBooks().then(b => { if (b?.length) setBooks(b); }).catch(e => console.warn("Failed to load books:", e));
    const d = store.get("biblion-dict"); if (d) setDictionary(d);
    const v = store.get("biblion-vocab-history"); if (v) setVocabHistory(v);
    const cw = store.get("biblion-current-word"); if (cw) setCurrentWord(cw);
    const lt = store.get("biblion-last-word-time"); if (lt) setLastWordTime(lt);
    const k = store.get("biblion-api-key"); if (k) setApiKey(k);
    const sp = store.get("biblion-saved-passages"); if (sp) setSavedPassages(sp);
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

  useEffect(() => {
    persist("biblion-tab", tab);
  }, [tab]);

  useEffect(() => {
    const canStepBack = () => !!readerBook || !!selectedBook || showSearch || showMyLibrary || showAddMenu || selectedShelf !== null || tab !== "books";

    const resetToTabRoot = () => {
      setReaderBook(null);
      setSelectedBook(null);
      setInsight(null);
      cancelEditing();
      setShowSearch(false);
      setSearchResults([]);
      setSearchQuery("");
      setShowMyLibrary(false);
      setShowAddMenu(false);
      setSelectedShelf(null);
      setShelfVolumes([]);
      setVolumesError(null);
    };

    const stepBack = () => {
      if (readerBook || selectedBook || showSearch || showMyLibrary || showAddMenu || selectedShelf !== null) {
        resetToTabRoot();
        return true;
      }
      if (tab !== "books") {
        setTab("books");
        return true;
      }
      return false;
    };

    const onPopState = () => {
      if (stepBack()) {
        window.history.pushState({ biblion: true }, "");
        return;
      }
      const now = Date.now();
      if (now - backPressRef.current.last < 1200) {
        window.removeEventListener("popstate", onPopState);
        window.history.back();
        return;
      }
      backPressRef.current.last = now;
      window.history.pushState({ biblion: true }, "");
    };

    window.history.replaceState({ biblion: true }, "");
    window.history.pushState({ biblion: true }, "");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [readerBook, selectedBook, showSearch, showMyLibrary, showAddMenu, selectedShelf, tab]);

  const handleBookUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      const ab = await file.arrayBuffer();
      const isEpub = file.name.toLowerCase().endsWith(".epub");
      let text, chapters;
      if (isEpub) {
        chapters = await extractEpubChapters(ab);
        text = chapters ? chapters.map(c => c.content).join("\n\n").slice(0, 80000) : await extractTextFromEpub(ab);
      } else {
        text = await extractTextFromPdfBytes(ab);
        chapters = splitIntoPages(text);
      }
      const nb = { id: Date.now().toString(), title: file.name.replace(/\.(epub|pdf)$/i, "").replace(/[_-]+/g, " "), fileName: file.name, textPreview: text.slice(0, 500), textContent: text, chapters: chapters || null, addedAt: new Date().toISOString(), insightCount: 0 };
      await putBook(nb);
      const u = [...books, nb]; setBooks(u);
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

  const lookupWord = async (word, options = {}) => {
    const q = (word || dictSearchQuery).trim().toLowerCase();
    if (!q) return;
    setDictSearching(true); setDictSearchError(""); setDictSearchResult(null);
    if (options.openModal) setLookupModalWord(q);
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q)}`);
      if (!res.ok) { setDictSearchError(res.status === 404 ? `"${q}" not found in dictionary.` : "Lookup failed. Try again."); setDictSearching(false); return; }
      const data = await res.json();
      const entry = data[0];
      const phonetic = entry.phonetics?.find(p => p.text)?.text || "";
      const meanings = entry.meanings || [];
      const firstMeaning = meanings[0] || {};
      const partOfSpeech = firstMeaning.partOfSpeech || "";
      const definition = firstMeaning.definitions?.[0]?.definition || "";
      const example = firstMeaning.definitions?.[0]?.example || "";
      const allDefs = meanings.map(m => `(${m.partOfSpeech}) ${m.definitions?.[0]?.definition || ""}`).join("; ");
      setDictSearchResult({ word: entry.word, pronunciation: phonetic, partOfSpeech, definition, allDefinitions: allDefs, example });
    } catch (err) { setDictSearchError("Network error. Check your connection."); }
    setDictSearching(false);
  };

  const addSearchWordToDict = () => {
    if (!dictSearchResult) return;
    const exists = dictionary.some(w => w.word.toLowerCase() === dictSearchResult.word.toLowerCase());
    if (exists) return;
    const updated = [...dictionary, { word: dictSearchResult.word, definition: dictSearchResult.allDefinitions || dictSearchResult.definition }];
    setDictionary(updated); persist("biblion-dict", updated);
  };

  const ensureApiKey = () => {
    if (apiKey) return true;
    setShowKeyInput(true);
    setTab("settings");
    return false;
  };

  const generatePassage = async (book) => {
    if (!ensureApiKey()) return;
    setLoading(true); setInsight(null);
    try {
      const rawChapters = getChapters(book);
      const currentChapterIdx = book.id === readerBook?.id ? readerChapterIdx : (store.get(`biblion-reader-${book.id}`)?.chapterIdx || 0);
      const chapter = rawChapters[currentChapterIdx] || rawChapters[0];
      const chapterText = chapter?.content || book.textContent.slice(0, 12000);
      const chapterChunks = splitIntoSentenceChunks(chapterText, 1, 4);
      const recentBodies = (store.get(`biblion-passage-history-${book.id}-${currentChapterIdx}`) || []).slice(0, 8);
      const sys = `You are Biblion, a literary curator in a dusty, candlelit bookshop. Choose one passage from the supplied chapter text and present it in 5 sentences or fewer. Do not repeat any prior passage if a distinct option exists. Respond ONLY in JSON: {"title":"","body":"","page_hint":"","reflection":""}`;
      const usr = `Give me one memorable passage from this exact chapter in 5 sentences or fewer. The reader is currently on chapter: "${chapter?.title || `Chapter ${currentChapterIdx + 1}`}". Prefer a chunk that has not been used recently.\n\nRecent passages to avoid:\n${recentBodies.join("\n---\n") || "None"}\n\nCandidate chunks:\n${chapterChunks.map((chunk, i) => `[Chunk ${i + 1}] ${chunk}`).join("\n\n") || chapterText}`;
      const raw = await askAI(sys, usr, apiKey);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setInsight(parsed);
      persist(`biblion-passage-history-${book.id}-${currentChapterIdx}`, [parsed.body, ...recentBodies].slice(0, 12));
      const u = books.map(b => b.id === book.id ? { ...b, insightCount: b.insightCount + 1 } : b);
      setBooks(u); putBook(u.find(b => b.id === book.id)).catch(() => {});
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

  const deleteBook = async (id) => { const u = books.filter(b => b.id !== id); setBooks(u); removeBook(id).catch(() => {}); if (selectedBook?.id === id) setSelectedBook(null); };

  const updateBook = (id, changes) => {
    const u = books.map(b => b.id === id ? { ...b, ...changes } : b);
    setBooks(u);
    const updated = u.find(b => b.id === id);
    if (updated) putBook(updated).catch(() => {});
    if (selectedBook?.id === id) setSelectedBook({ ...selectedBook, ...changes });
  };

  const startEditing = (field, value) => { setEditingField(field); setEditValue(value); };
  const startEditingBoth = (title, desc) => { setEditingField("both"); setEditValue(title); setEditDescValue(desc); };
  const cancelEditing = () => { setEditingField(null); setEditValue(""); setEditDescValue(""); };
  const saveEditing = (bookId) => {
    if (editingField === "both") {
      const changes = {};
      if (editValue.trim()) changes.title = editValue.trim();
      if (editDescValue.trim()) changes.textPreview = editDescValue.trim();
      if (Object.keys(changes).length) updateBook(bookId, changes);
    } else if (editingField && editValue.trim()) {
      updateBook(bookId, { [editingField]: editValue.trim() });
    }
    cancelEditing();
  };

  const checkApiBalance = async () => {
    if (!ensureApiKey()) return;
    setCheckingApiBalance(true);
    setApiBalanceError("");
    try {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || data?.message || "Could not check API balance.");
      setApiBalanceInfo(data);
    } catch (err) {
      setApiBalanceInfo(null);
      setApiBalanceError(err.message || "Could not check API balance.");
    }
    setCheckingApiBalance(false);
  };

  const balanceLooksLow = (info) => {
    const total = parseFloat(info?.total_balance || "0");
    if (info?.currency === "USD") return total < 5;
    if (info?.currency === "CNY") return total < 35;
    return total <= 0;
  };

  const searchGoogleBooks = async (query) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const q = `intitle:${trimmed} OR inauthor:${trimmed}`;
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=12&printType=books`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Search failed.");
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

  const addFromGoogleBooks = async (item) => {
    const info = item.volumeInfo;
    const access = item.accessInfo;
    setAddingBookId(item.id);

    let textContent = null;
    let chapters = null;

    const downloadUrl = access?.epub?.downloadLink || access?.pdf?.downloadLink;
    const isEpub = !!access?.epub?.downloadLink;

    if (downloadUrl && googleAccessToken) {
      try {
        const res = await fetch("/api/book-download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ downloadUrl, accessToken: googleAccessToken }),
        });
        if (res.ok) {
          const { data } = await res.json();
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
          const ab = bytes.buffer;
          if (isEpub) {
            chapters = await extractEpubChapters(ab);
            textContent = chapters
              ? chapters.map(c => c.content).join("\n\n").slice(0, 80000)
              : await extractTextFromEpub(ab);
          } else {
            textContent = await extractTextFromPdfBytes(ab);
            chapters = splitIntoPages(textContent);
          }
        }
      } catch {}
    }

    if (!textContent) {
      const parts = [
        `Title: ${info.title || "Unknown"}`,
        info.authors ? `Author(s): ${info.authors.join(", ")}` : "",
        info.publishedDate ? `Published: ${info.publishedDate}` : "",
        info.categories ? `Categories: ${info.categories.join(", ")}` : "",
        info.description ? `\nDescription:\n${info.description}` : "",
      ].filter(Boolean);
      textContent = parts.join("\n");
    }

    const nb = {
      id: Date.now().toString(),
      title: info.title || "Unknown Title",
      author: info.authors?.join(", ") || "",
      fileName: "",
      textPreview: info.description?.slice(0, 500) || "No description available.",
      textContent,
      chapters: chapters || null,
      addedAt: new Date().toISOString(),
      insightCount: 0,
      coverUrl: info.imageLinks?.thumbnail?.replace("http://", "https://") || null,
      source: "google-books",
      hasFullText: !!chapters,
    };
    try { await putBook(nb); } catch (e) { alert("Could not save book — storage may be full."); setAddingBookId(null); return; }
    const u = [...books, nb];
    setBooks(u);
    setAddingBookId(null);
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  const getChapters = (book) => {
    if (book?.chapters?.length) return book.chapters;
    if (book?.textContent) return splitIntoPages(book.textContent);
    return [];
  };

  const chapterChunks = useMemo(() => readerBook ? getChapterChunks(getChapters(readerBook)) : [], [readerBook]);

  const openReader = (book) => {
    const saved = store.get(`biblion-reader-${book.id}`) || { chapterIdx: 0, chunkIdx: 0 };
    setReaderChapterIdx(saved.chapterIdx || 0);
    setReaderChunkIdx(saved.chunkIdx || 0);
    setReaderBook(book);
  };

  const persistReaderPosition = (bookId, chapterIdx, chunkIdx) => {
    store.set(`biblion-reader-${bookId}`, { chapterIdx, chunkIdx });
  };

  const goToChapter = (idx) => {
    const safeIdx = Math.max(0, Math.min(idx, chapterChunks.length - 1));
    setReaderChapterIdx(safeIdx);
    setReaderChunkIdx(0);
    if (readerBook) persistReaderPosition(readerBook.id, safeIdx, 0);
  };

  const moveReaderChunk = (direction) => {
    if (!readerBook || !chapterChunks.length) return;
    let nextChapter = readerChapterIdx;
    let nextChunk = readerChunkIdx + direction;
    if (nextChunk < 0) {
      if (nextChapter === 0) return;
      nextChapter -= 1;
      nextChunk = chapterChunks[nextChapter].chunks.length - 1;
    } else if (nextChunk >= chapterChunks[nextChapter].chunks.length) {
      if (nextChapter === chapterChunks.length - 1) return;
      nextChapter += 1;
      nextChunk = 0;
    }
    setReaderChapterIdx(nextChapter);
    setReaderChunkIdx(nextChunk);
    persistReaderPosition(readerBook.id, nextChapter, nextChunk);
  };

  const savePassage = (book, chapter, chunk) => {
    const entry = {
      id: `${book.id}:${chapter.chapterIndex}:${chunk.chunkIndex}`,
      bookId: book.id,
      bookTitle: book.title,
      chapterTitle: chapter.chapterTitle,
      chapterIndex: chapter.chapterIndex,
      chunkIndex: chunk.chunkIndex,
      chunkLabel: chunk.chunkLabel,
      content: chunk.content,
      savedAt: new Date().toISOString()
    };
    const exists = savedPassages.some(p => p.id === entry.id);
    const next = exists ? savedPassages : [entry, ...savedPassages];
    setSavedPassages(next);
    persist("biblion-saved-passages", next);
  };

  const spineColor = (title) => {
    const colors = [C.rose, C.accent, C.gold, "#8B6B5A", "#7A6858", "#6B8A8C", "#A07868"];
    let h = 0; for (let i = 0; i < title.length; i++) h = title.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Cormorant Garamond', 'Georgia', serif", maxWidth: 430, width: "100%", aspectRatio: "9 / 16", margin: "0 auto", position: "relative", paddingBottom: 84, overflowX: "hidden" }}>
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
        .tab-bar { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); max-width: 480px; width: 100%; background: ${C.tabBarBg}; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); border-top: 1px solid ${C.border}; display: flex; justify-content: space-around; padding: 8px 0 28px; z-index: 100; }
        .tab-item { display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; color: ${C.textDim}; cursor: pointer; font-family: 'Cormorant Garamond', serif; font-size: 11px; font-weight: 500; padding: 6px 20px; transition: color 0.2s ease; position: relative; }
        .tab-item.active { color: ${C.rose}; }
        .insight-card { background: linear-gradient(145deg, ${C.bgCard} 0%, ${C.bgSurface} 50%, ${C.bgCard} 100%); border: 1px solid ${C.borderHover}; border-radius: 16px; padding: 24px; position: relative; overflow: hidden; }
        .insight-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${C.accent}, ${C.rose}, ${C.gold}); opacity: 0.6; }
        .insight-card::after { content: ''; position: absolute; top: -60px; right: -60px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, ${C.roseSoft} 0%, transparent 70%); pointer-events: none; }
        .vocab-card { background: linear-gradient(145deg, ${C.bgSurface} 0%, ${C.bgCard} 100%); border: 1px solid rgba(95,158,160,0.2); border-radius: 16px; padding: 24px; position: relative; overflow: hidden; }
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
            {tab === "books" ? "The Stacks" : tab === "vocab" ? "Word Alcove" : "Settings"}
          </div>
        </div>
        {tab === "books" && !selectedBook && !showSearch && !showMyLibrary && !showAddMenu && (
          <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center" }}>
            <button onClick={() => { setShowSearch(true); setShowAddMenu(false); setShowMyLibrary(false); setSelectedShelf(null); setShelfVolumes([]); }} style={{ width: 38, height: 38, borderRadius: 10, background: "transparent", color: C.textMid, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
              <IconSearch />
            </button>
            <button onClick={() => { setShowAddMenu(s => !s); setShowSearch(false); setShowMyLibrary(false); setSelectedShelf(null); setShelfVolumes([]); }} style={{ width: 38, height: 38, borderRadius: 10, background: showAddMenu ? C.bgSurface : `linear-gradient(135deg, ${C.rose}, #A86E73)`, color: showAddMenu ? C.rose : "#fff", border: showAddMenu ? `1px solid ${C.rose}` : "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: showAddMenu ? "none" : "0 2px 10px rgba(196,134,139,0.25)" }}>
              {showAddMenu ? <IconClose /> : <IconPlus />}
            </button>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept=".epub,.pdf" onChange={handleBookUpload} />
      <input ref={dictInputRef} type="file" accept=".txt,.csv,.tsv" onChange={handleDictUpload} />

      <div style={{ padding: "0 22px", position: "relative", zIndex: 1 }}>

        {tab === "books" && !selectedBook && showAddMenu && (
          <div className="fade-up" style={{ paddingTop: 14, marginBottom: 12 }}>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 600, fontStyle: "italic" }}>Add a book</div>
              <button className="btn-rose" onClick={() => { setShowAddMenu(false); fileInputRef.current?.click(); }}>Upload EPUB or PDF</button>
              {googleAccessToken && <button className="btn-primary" onClick={() => { setShowAddMenu(false); setShowMyLibrary(true); }}>My Google Library</button>}
            </div>
          </div>
        )}

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
                      <button onClick={() => addFromGoogleBooks(item)} disabled={alreadyAdded || addingBookId === item.id} style={{ alignSelf: "center", flexShrink: 0, background: alreadyAdded ? "transparent" : `linear-gradient(135deg, ${C.accent}, #4D8A8C)`, color: alreadyAdded ? C.textDim : "#fff", border: alreadyAdded ? `1px solid ${C.border}` : "none", borderRadius: 8, padding: "7px 12px", cursor: (alreadyAdded || addingBookId === item.id) ? "default" : "pointer", fontSize: 12, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, whiteSpace: "nowrap", opacity: addingBookId === item.id ? 0.6 : 1 }}>
                        {addingBookId === item.id ? "Adding…" : alreadyAdded ? "Shelved" : "+ Shelve"}
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
                        <button onClick={() => addFromGoogleBooks(item)} disabled={alreadyAdded || addingBookId === item.id} style={{ alignSelf: "center", flexShrink: 0, background: alreadyAdded ? "transparent" : `linear-gradient(135deg, ${C.accent}, #4D8A8C)`, color: alreadyAdded ? C.textDim : "#fff", border: alreadyAdded ? `1px solid ${C.border}` : "none", borderRadius: 8, padding: "7px 12px", cursor: (alreadyAdded || addingBookId === item.id) ? "default" : "pointer", fontSize: 12, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, whiteSpace: "nowrap", opacity: addingBookId === item.id ? 0.6 : 1 }}>
                          {addingBookId === item.id ? "Adding…" : alreadyAdded ? "Shelved" : "+ Shelve"}
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
            <button className="btn-ghost" onClick={() => { setSelectedBook(null); setInsight(null); cancelEditing(); }} style={{ marginBottom: 18 }}>‹ Back to the Stacks</button>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 4 }}>
              {selectedBook.coverUrl ? (
                <img src={selectedBook.coverUrl} alt="" style={{ width: 54, height: 76, objectFit: "cover", borderRadius: 5, flexShrink: 0, opacity: 0.92 }} />
              ) : (
                <div className="book-spine" style={{ background: spineColor(selectedBook.title), height: 36, alignSelf: "center" }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2, paddingBottom: 2, flex: 1 }}>{selectedBook.title}</div>
                  {editingField !== "both" && <button className="btn-ghost" onClick={() => startEditingBoth(selectedBook.title, selectedBook.textPreview || "")} style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}>Edit</button>}
                </div>
                {selectedBook.author && <div style={{ fontSize: 13, color: C.textMid, marginTop: 4, fontStyle: "italic" }}>{selectedBook.author}</div>}
              </div>
            </div>
            {editingField === "both" ? (
              <div style={{ marginBottom: 22 }}>
                <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4, display: "block" }} className="mono">Title</label>
                <input
                  autoFocus
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") cancelEditing(); }}
                  style={{ fontSize: 18, fontWeight: 600, background: C.bgSurface, border: `1px solid ${C.borderHover}`, borderRadius: 6, color: C.text, padding: "6px 10px", width: "100%", outline: "none", marginBottom: 12, boxSizing: "border-box" }}
                />
                <label style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4, display: "block" }} className="mono">Description</label>
                <textarea
                  value={editDescValue}
                  onChange={e => setEditDescValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") cancelEditing(); }}
                  rows={3}
                  style={{ width: "100%", fontSize: 13, background: C.bgSurface, border: `1px solid ${C.borderHover}`, borderRadius: 6, color: C.text, padding: "8px 10px", outline: "none", resize: "vertical", lineHeight: 1.6, fontFamily: "inherit", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                  <button className="btn-ghost" onClick={() => saveEditing(selectedBook.id)} style={{ padding: "4px 10px", fontSize: 12 }}>Save</button>
                  <button className="btn-ghost" onClick={cancelEditing} style={{ padding: "4px 10px", fontSize: 12 }}>✕</button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 13, color: C.textMid, marginBottom: 8, lineHeight: 1.6, paddingBottom: 4 }} className="serif-body">{selectedBook.textPreview}</div>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <button className="btn-primary" onClick={() => generatePassage(selectedBook)} disabled={loading} style={{ flex: 1, width: "auto" }}>{loading ? "Finding a passage…" : "Passage"}</button>
              <button className="btn-ghost" onClick={() => openReader(selectedBook)} style={{ flex: 1, padding: "0 18px" }}>Read Book ›</button>
            </div>
            {savedPassages.filter(p => p.bookId === selectedBook.id).length > 0 && (
              <div style={{ marginBottom: 20, background: C.bgSurface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 12, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }} className="mono">Saved</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {savedPassages.filter(p => p.bookId === selectedBook.id).slice(0, 6).map(p => (
                    <div key={p.id} style={{ borderLeft: `2px solid ${C.gold}`, paddingLeft: 10 }}>
                      <div style={{ fontSize: 11, color: C.textDim }} className="mono">{p.chapterTitle} · {p.chunkLabel}</div>
                      <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.6 }} className="serif-body">{p.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loading && <Spinner />}
            {insight && !loading && (
              <div className="fade-up" style={{ marginTop: 22 }}>
                <div className="insight-card">
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 11, color: C.rose, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, marginBottom: 14 }} className="mono">Passage</div>
                    <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, lineHeight: 1.35 }}>{insight.title}</div>
                    <div style={{ fontSize: 15, color: C.textMid, lineHeight: 1.75, marginBottom: 14 }} className="serif-body">{renderTappableWords(insight.body, (w) => lookupWord(w, { openModal: true }), C.textMid)}</div>
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
          <div className="fade-up" style={{ paddingTop: 8 }}>
            {/* Dictionary Search */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input
                  className="search-input"
                  value={dictSearchQuery}
                  onChange={e => setDictSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") lookupWord(); }}
                  placeholder="Look up a word…"
                  style={{ flex: 1 }}
                />
                <button className="btn-primary" onClick={() => lookupWord()} disabled={dictSearching} style={{ width: "auto", padding: "0 18px", flexShrink: 0, fontSize: 14 }}>
                  {dictSearching ? "…" : "Look Up"}
                </button>
              </div>
              {dictSearchError && <div style={{ fontSize: 13, color: C.rose, marginBottom: 6 }}>{dictSearchError}</div>}
              {dictSearchResult && (
                <div className="vocab-card fade-up" style={{ marginBottom: 4, padding: 16 }}>
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 1 }}>{dictSearchResult.word}</div>
                    {dictSearchResult.pronunciation && <div style={{ fontSize: 12, color: C.textDim, marginBottom: 1 }} className="mono">{dictSearchResult.pronunciation}</div>}
                    {dictSearchResult.partOfSpeech && <div style={{ fontSize: 12, color: C.rose, fontStyle: "italic", marginBottom: 8 }}>{dictSearchResult.partOfSpeech}</div>}
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: C.text, marginBottom: 8 }} className="serif-body">{dictSearchResult.definition}</div>
                    {dictSearchResult.example && <div style={{ fontSize: 12, color: C.textMid, fontStyle: "italic", lineHeight: 1.5, marginBottom: 6 }} className="serif-body">{smartenQuotes(`"${dictSearchResult.example}"`)}</div>}
                    <button className="btn-ghost" onClick={addSearchWordToDict} style={{ fontSize: 12, padding: "5px 10px" }}>
                      {dictionary.some(w => w.word.toLowerCase() === dictSearchResult.word.toLowerCase()) ? "Already in lexicon" : "+ Add to Lexicon"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="divider" style={{ margin: "10px 0" }} />

            {dictionary.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 16px" }}>
                <div style={{ fontSize: 13, color: C.textMid, marginBottom: 12, lineHeight: 1.6 }} className="serif-body">Search words above to build your lexicon.</div>
              </div>
            ) : (
              <>
                {!wordReady && currentWord && (
                  <div style={{ background: C.bgSurface, borderRadius: 10, padding: 10, marginBottom: 10, textAlign: "center", fontSize: 13, color: C.textMid, border: `1px solid ${C.border}` }}>
                    Next word arrives in <span style={{ color: C.accent, fontWeight: 600 }}>{hrsLeft > 0 ? `${hrsLeft}h ${minsRem}m` : `${minsLeft}m`}</span>
                  </div>
                )}
                {(wordReady || !currentWord) && (
                  <button className="btn-primary" onClick={getNewWord} disabled={loading} style={{ marginBottom: 12, padding: "11px 18px" }}>
                    {loading ? "Searching the dictionary…" : currentWord ? "Turn Another Page" : "Your First Word Awaits"}
                  </button>
                )}
                {loading && <Spinner />}
                {currentWord && !loading && (
                  <div className="vocab-card fade-up" style={{ marginBottom: 14, padding: 18 }}>
                    <div style={{ position: "relative", zIndex: 1 }}>
                      <div style={{ fontSize: 10, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }} className="mono">Today's Word</div>
                      <div style={{ fontSize: 26, fontWeight: 600, marginBottom: 1, letterSpacing: "0.3px" }}>{currentWord.word}</div>
                      {currentWord.pronunciation && <div style={{ fontSize: 12, color: C.textDim, marginBottom: 1 }} className="mono">{currentWord.pronunciation}</div>}
                      {currentWord.partOfSpeech && <div style={{ fontSize: 12, color: C.rose, fontStyle: "italic", marginBottom: 10 }}>{currentWord.partOfSpeech}</div>}
                      <div style={{ fontSize: 14, lineHeight: 1.6, color: C.text, marginBottom: 10 }} className="serif-body">{currentWord.definition}</div>
                      {currentWord.example && (<><div className="divider" style={{ margin: "8px 0" }} /><div style={{ fontSize: 13, color: C.textMid, fontStyle: "italic", lineHeight: 1.5, marginBottom: 8 }} className="serif-body">{smartenQuotes(`"${currentWord.example}"`)}</div></>)}
                      {currentWord.etymology && <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.4 }} className="serif-body"><span style={{ color: C.gold }}>Origin</span> — {currentWord.etymology}</div>}
                    </div>
                  </div>
                )}
                {vocabHistory.length > 1 && (
                  <>
                    <div className="divider-ornament" style={{ margin: "20px 0 22px" }}>· · ·</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18, color: C.textMid, fontStyle: "italic" }}>Words you've collected</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 32 }}>
                      {vocabHistory.slice(1, 11).map((w, i) => (
                        <div key={i} className="card" style={{ padding: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 15, fontWeight: 600 }}>{w.word}</span>
                            <span style={{ fontSize: 10, color: C.textDim }} className="mono">{w.partOfSpeech}</span>
                          </div>
                          <div style={{ fontSize: 12, color: C.textMid, marginTop: 3, lineHeight: 1.4 }} className="serif-body">{smartenQuotes(w.definition)}</div>
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
            {/* Appearance */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, fontStyle: "italic" }}>Appearance</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["dark", "Dark"], ["light", "Light"]].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => { setTheme(id); store.set("biblion-theme", id); }}
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: `1.5px solid ${theme === id ? C.accent : C.border}`,
                      background: theme === id ? C.accentSoft : "transparent",
                      color: theme === id ? C.accent : C.textMid,
                      fontFamily: "'Cormorant Garamond', serif",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
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
                    onChange={e => { setApiKey(e.target.value); setApiBalanceInfo(null); setApiBalanceError(""); }}
                  />
                  <button className="btn-primary" onClick={() => {
                    persist("biblion-api-key", apiKey);
                    setApiBalanceInfo(null);
                    setApiBalanceError("");
                    setShowKeyInput(false);
                  }} disabled={!apiKey} style={{ fontSize: 14 }}>
                    Save Key
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn-ghost" onClick={() => setShowKeyInput(true)} style={{ fontSize: 13 }}>
                      Change Key
                    </button>
                    <button className="btn-primary" onClick={checkApiBalance} disabled={checkingApiBalance} style={{ fontSize: 13 }}>
                      {checkingApiBalance ? "Checking Balance…" : "Check API Balance"}
                    </button>
                  </div>
                  {apiBalanceError && (
                    <div style={{ fontSize: 12, color: C.rose, lineHeight: 1.6 }} className="serif-body">{apiBalanceError}</div>
                  )}
                  {apiBalanceInfo?.balance_infos?.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {apiBalanceInfo.balance_infos.map((info, idx) => {
                        const low = balanceLooksLow(info);
                        return (
                          <div key={`${info.currency}-${idx}`} style={{ background: C.bgInset, border: `1px solid ${low ? C.rose : C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 12, color: C.textDim }} className="mono">{info.currency}</span>
                              <span style={{ fontSize: 12, color: low || apiBalanceInfo.is_available === false ? C.rose : C.accent, fontWeight: 600 }}>
                                {apiBalanceInfo.is_available === false ? "Balance too low" : low ? "Running low" : "Balance looks fine"}
                              </span>
                            </div>
                            <div style={{ fontSize: 14, color: C.text, marginBottom: 4 }} className="serif-body">Available balance: {info.total_balance} {info.currency}</div>
                            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6 }} className="mono">Granted: {info.granted_balance} · Topped up: {info.topped_up_balance}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
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
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, fontStyle: "italic" }}>Your Collection</div>
              <div style={{ fontSize: 14, color: C.textMid, marginBottom: 14 }} className="serif-body">{books.length} book{books.length !== 1 ? "s" : ""} shelved · {dictionary.length} words in lexicon · {vocabHistory.length} words learned</div>
              <button className="btn-ghost" style={{ fontSize: 13, color: "#C46B6B" }} onClick={() => {
                if (confirm("Clear everything from the shop? This cannot be undone.")) {
                  setBooks([]); setDictionary([]); setVocabHistory([]); setCurrentWord(null); setLastWordTime(0);
                  clearAllBooks().catch(() => {});
                  store.del("biblion-books"); store.del("biblion-dict"); store.del("biblion-vocab-history");
                  store.del("biblion-current-word"); store.del("biblion-last-word-time");
                }
              }}>Clear All Data</button>
            </div>
            <div style={{ height: 24 }} />
          </div>
        )}
      </div>

      {/* Reader overlay */}
      {readerBook && (
        <ReaderView
          book={readerBook}
          chapterIdx={readerChapterIdx}
          chapters={chapterChunks}
          chunkIdx={readerChunkIdx}
          onClose={() => setReaderBook(null)}
          onChapterChange={goToChapter}
          onChunkChange={moveReaderChunk}
          onSaveChunk={(chapter, chunk) => savePassage(readerBook, chapter, chunk)}
          savedChunkIds={savedPassages.map(p => p.id)}
          onWordTap={(word) => lookupWord(word, { openModal: true })}
        />
      )}

      {lookupModalWord && dictSearchResult && (
        <div onClick={() => setLookupModalWord("")} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card" onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, padding: 18, background: C.bgCard }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{dictSearchResult.word}</div>
                {dictSearchResult.pronunciation && <div style={{ fontSize: 12, color: C.textDim }} className="mono">{dictSearchResult.pronunciation}</div>}
              </div>
              <button className="btn-ghost" onClick={() => setLookupModalWord("")} style={{ padding: "4px 8px", fontSize: 12 }}>✕</button>
            </div>
            {dictSearchResult.partOfSpeech && <div style={{ fontSize: 12, color: C.rose, fontStyle: "italic", marginBottom: 8 }}>{dictSearchResult.partOfSpeech}</div>}
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6 }} className="serif-body">{dictSearchResult.definition}</div>
            {dictSearchResult.example && <div style={{ fontSize: 12, color: C.textMid, fontStyle: "italic", lineHeight: 1.5, marginTop: 10 }} className="serif-body">{smartenQuotes(`"${dictSearchResult.example}"`)}</div>}
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="tab-bar">
        {[["books","The Stacks",<IconBook key="b"/>],["vocab","Word Alcove",<IconVocab key="v"/>],["settings","Settings",<IconSettings key="s"/>]].map(([id,label,icon]) => (
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
