// Copy this file to js/firebase-config.local.js and fill it with values from
// Firebase Console → Project settings → Your apps → Firebase SDK config.
//
// Do not commit js/firebase-config.local.js. It should be generated from
// local environment files or GitHub Actions secrets for production deploys.

window.MANA_FIREBASE_CONFIGS = {
  pre: {
    apiKey: 'PRE_API_KEY',
    authDomain: 'your-pre-project.firebaseapp.com',
    databaseURL: 'https://your-pre-project-default-rtdb.firebaseio.com',
    projectId: 'your-pre-project',
    storageBucket: 'your-pre-project.firebasestorage.app',
    messagingSenderId: 'PRE_MESSAGING_SENDER_ID',
    appId: 'PRE_APP_ID',
    measurementId: 'PRE_MEASUREMENT_ID'
  },
  pro: {
    apiKey: 'PRO_API_KEY',
    authDomain: 'your-pro-project.firebaseapp.com',
    databaseURL: 'https://your-pro-project-default-rtdb.firebaseio.com',
    projectId: 'your-pro-project',
    storageBucket: 'your-pro-project.firebasestorage.app',
    messagingSenderId: 'PRO_MESSAGING_SENDER_ID',
    appId: 'PRO_APP_ID',
    measurementId: 'PRO_MEASUREMENT_ID'
  }
};
