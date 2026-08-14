/*
    config.js

    LANZAR Support Tickets Firebase configuration.

    Responsibilities

    - Initialize the LANZAR Firebase project
    - Provide the shared Firebase application instance
*/

import { initializeApp } from 'firebase/app'

// ==========================
// Firebase Configuration
// ==========================

const firebaseConfig = {
  apiKey: 'AIzaSyCm11MJPwYKk2ckDIrTOGLNHdyFkdCOM2k',
  authDomain: 'lanzar-95ae3.firebaseapp.com',
  projectId: 'lanzar-95ae3',
  storageBucket: 'lanzar-95ae3.firebasestorage.app',
  messagingSenderId: '61309916889',
  appId: '1:61309916889:web:a6bce4cb213af2a52250c8',
  measurementId: 'G-XCSPZLNR02',
}

// ==========================
// Firebase Application
// ==========================

const app = initializeApp(firebaseConfig)

export default app