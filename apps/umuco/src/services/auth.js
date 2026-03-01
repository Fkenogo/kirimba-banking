import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase";

export function signUpAccount(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signInAccount(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutAccount() {
  return signOut(auth);
}
