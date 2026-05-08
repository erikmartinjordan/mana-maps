#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

const REQUIRED_FIREBASE_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const CONFIG_ENV_VARS = [
  ['pre', 'FIREBASE_PRE_CONFIG_JSON'],
  ['pro', 'FIREBASE_PRO_CONFIG_JSON']
];

function extractAssignedObject(source) {
  const trimmed = source.trim();
  const assignmentPatterns = [
    /^(?:const|let|var)\s+\w+\s*=\s*([\s\S]*?);?$/,
    /^window\.MANA_FIREBASE_CONFIGS\s*=\s*([\s\S]*?);?$/,
    /^export\s+default\s+([\s\S]*?);?$/
  ];

  for (const pattern of assignmentPatterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1].trim();
  }

  const firebaseSnippetMatch = trimmed.match(/(?:const|let|var)\s+\w+\s*=\s*({[\s\S]*?})\s*;/);
  if (firebaseSnippetMatch) return firebaseSnippetMatch[1].trim();

  return trimmed;
}

function parseObjectLiteral(raw, name) {
  const source = extractAssignedObject(raw);

  try {
    return JSON.parse(source);
  } catch (jsonError) {
    try {
      return vm.runInNewContext(`(${source})`, Object.freeze({}), { timeout: 1000 });
    } catch (objectLiteralError) {
      throw new Error(
        `${name} must be valid JSON or a Firebase web config object literal. ` +
        `JSON parse failed with: ${jsonError.message}. ` +
        `Object-literal parse failed with: ${objectLiteralError.message}.`
      );
    }
  }
}

function requireConfigShape(config, name) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${name} must resolve to a Firebase config object`);
  }

  for (const key of REQUIRED_FIREBASE_KEYS) {
    if (!config[key]) throw new Error(`${name}.${key} is required`);
  }

  return config;
}

function readConfig(name, envKey) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) throw new Error(`${name} is required`);

  const parsed = parseObjectLiteral(raw, name);
  const config = parsed && !parsed.apiKey && parsed[envKey] ? parsed[envKey] : parsed;
  return requireConfigShape(config, name);
}

function buildRuntimeConfigs() {
  return Object.fromEntries(
    CONFIG_ENV_VARS.map(([envKey, envVar]) => [envKey, readConfig(envVar, envKey)])
  );
}

function writeRuntimeConfig(outputPath = 'js/firebase-config.local.js') {
  const configs = buildRuntimeConfigs();
  fs.writeFileSync(
    outputPath,
    `window.MANA_FIREBASE_CONFIGS = ${JSON.stringify(configs, null, 2)};\n`
  );
}

if (require.main === module) {
  writeRuntimeConfig(process.argv[2]);
}

module.exports = {
  buildRuntimeConfigs,
  parseObjectLiteral,
  readConfig,
  writeRuntimeConfig
};
