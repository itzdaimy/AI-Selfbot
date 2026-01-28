require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { startClient } = require('./client');

const dirs = [
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..', 'data', 'profiles'),
    path.join(__dirname, '..', 'data', 'memory'),
    path.join(__dirname, '..', 'data', 'memory', 'users')
];

for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

let config;
try {
    config = require('../config.json');
} catch (e) {
    console.error('missing config.json');
    process.exit(1);
}

if (!process.env.DISCORD_TOKEN) {
    console.error('missing DISCORD_TOKEN');
    process.exit(1);
}

const provider = config.provider || 'openrouter';

if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
    console.error('missing OPENROUTER_API_KEY');
    process.exit(1);
}

startClient();