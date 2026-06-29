import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAc5AunmIuRg7BQo_v09nkbVmcBPdU4Xm8",
  authDomain: "bq-cardapio.firebaseapp.com",
  projectId: "bq-cardapio",
  storageBucket: "bq-cardapio.firebasestorage.app",
  messagingSenderId: "585287341859",
  appId: "1:585287341859:web:40448d280b88897e999e96"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp
};

export const paths = {
  admins: "admins",
  estabelecimentos: "estabelecimentos",
  solicitacoes: "solicitacoes_estabelecimentos",
  clientes: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/clientes`,
  pedidos: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/pedidos`,
  categorias: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/categorias`,
  produtos: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/produtos`,
  adicionais: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/adicionais`,
  financeiro: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/financeiro`,
  configuracoes: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/configuracoes`,
  taxas: (estabelecimentoId) => `estabelecimentos/${estabelecimentoId}/taxas`,
  logs: "logs"
};
