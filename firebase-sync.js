// Firebase Firestoreとの同期処理
// script.js（通常のscript）とは window.PinMapSync 経由でやり取りする

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTg1Co8LVyvSlzKHf_VCMwrASEtzOZ5b0",
  authDomain: "hyoushiki-tyousa.firebaseapp.com",
  projectId: "hyoushiki-tyousa",
  storageBucket: "hyoushiki-tyousa.firebasestorage.app",
  messagingSenderId: "460669129779",
  appId: "1:460669129779:web:70f8440fb149408dadbf46"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 進捗はこの1つのドキュメントにまとめて保存する
const progressRef = doc(db, "pinmap", "progress");

let saveTimer = null;
let pendingPayload = null;

function flushSave() {
  if (!pendingPayload) return;
  const payload = pendingPayload;
  pendingPayload = null;

  window.dispatchEvent(new CustomEvent("pinmap-sync-saving"));

  setDoc(progressRef, { ...payload, updatedAt: Date.now() })
    .then(() => {
      window.dispatchEvent(new CustomEvent("pinmap-sync-saved"));
    })
    .catch(err => {
      console.error("Firestoreへの保存に失敗:", err);
      window.dispatchEvent(new CustomEvent("pinmap-sync-error", { detail: String(err) }));
    });
}

// 連続操作をまとめて1回の書き込みにする（デバウンス）
window.PinMapSync = {
  save(payload) {
    pendingPayload = payload;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
  }
};

let firstSnapshot = true;

onSnapshot(
  progressRef,
  { includeMetadataChanges: true },
  (snap) => {
    if (!snap.exists()) {
      if (firstSnapshot) {
        // まだクラウドに何も無い＝この端末が最初の同期。今のローカルデータで作成する。
        window.dispatchEvent(new CustomEvent("pinmap-sync-empty"));
      }
      firstSnapshot = false;
      return;
    }
    firstSnapshot = false;

    // hasPendingWrites=true は「自分がまさに今書き込んだデータのエコー」。
    // 既にローカル側は正しい状態になっているので、ここで再マージする必要はない。
    if (snap.metadata.hasPendingWrites) return;

    window.dispatchEvent(new CustomEvent("pinmap-remote-update", { detail: snap.data() }));
  },
  (err) => {
    console.error("Firestoreの監視に失敗:", err);
    window.dispatchEvent(new CustomEvent("pinmap-sync-error", { detail: String(err) }));
  }
);

window.dispatchEvent(new CustomEvent("pinmap-sync-ready"));
