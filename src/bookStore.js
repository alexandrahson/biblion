// ─── IndexedDB storage for books ────────────────────────────────────
// Books contain large text payloads (textContent, chapters) that can
// exceed the ~5-10 MB localStorage quota. IndexedDB has no practical
// size limit for this use-case. Small settings stay in localStorage.

const DB_NAME = "biblion";
const DB_VERSION = 1;
const BOOKS = "books";

let _db = null;

function getDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BOOKS)) {
        db.createObjectStore(BOOKS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllBooks() {
  const db = await getDB();
  const tx = db.transaction(BOOKS, "readonly");
  return wrap(tx.objectStore(BOOKS).getAll());
}

export async function putBook(book) {
  const db = await getDB();
  const tx = db.transaction(BOOKS, "readwrite");
  return wrap(tx.objectStore(BOOKS).put(book));
}

export async function removeBook(id) {
  const db = await getDB();
  const tx = db.transaction(BOOKS, "readwrite");
  return wrap(tx.objectStore(BOOKS).delete(id));
}

export async function clearAllBooks() {
  const db = await getDB();
  const tx = db.transaction(BOOKS, "readwrite");
  return wrap(tx.objectStore(BOOKS).clear());
}

/**
 * On first run, migrate any books stored in localStorage into IndexedDB,
 * then remove the localStorage key to free quota. Always returns the
 * current book list from IndexedDB.
 */
export async function loadBooks() {
  const raw = localStorage.getItem("biblion-books");
  if (raw) {
    try {
      const lsBooks = JSON.parse(raw);
      if (Array.isArray(lsBooks) && lsBooks.length > 0) {
        const existing = await getAllBooks();
        if (existing.length === 0) {
          const db = await getDB();
          const tx = db.transaction(BOOKS, "readwrite");
          const store = tx.objectStore(BOOKS);
          for (const b of lsBooks) store.put(b);
          await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          });
        }
      }
    } catch (e) {
      console.warn("localStorage → IndexedDB migration failed:", e);
    }
    // Always remove the key to free space, even if migration failed
    // (the books are either in IDB now, or were already there)
    try { localStorage.removeItem("biblion-books"); } catch {}
  }
  return getAllBooks();
}
