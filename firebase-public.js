import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAc5AunmIuRg7BQo_v09nkbVmcBPdU4Xm8",
  authDomain: "bq-cardapio.firebaseapp.com",
  projectId: "bq-cardapio",
  storageBucket: "bq-cardapio.firebasestorage.app",
  messagingSenderId: "585287341859",
  appId: "1:585287341859:web:40448d280b88897e999e96"
};

const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
  addDoc,
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
};
