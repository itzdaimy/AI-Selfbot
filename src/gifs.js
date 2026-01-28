const fs = require('fs');
const path = require('path');

const gifsPath = path.join(__dirname, '..', 'gifs.json');

function loadGifs() {
    try {
        if (!fs.existsSync(gifsPath)) return null;
        return JSON.parse(fs.readFileSync(gifsPath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function buildGifPrompt() {
    const config = loadGifs();
    if (!config || !config.enabled || !config.gifs || config.gifs.length === 0) return '';

    let prompt = '\n\n--- GIF Responses ---\n';
    prompt += 'You can respond with JUST a gif instead of text when it fits. To use a gif, respond with only [GIF:X] where X is the number.\n';
    prompt += 'Only use gifs occasionally when it really fits. Available gifs:\n';

    config.gifs.forEach((gif, i) => {
        prompt += `[GIF:${i}] - ${gif.context}\n`;
    });

    return prompt;
}

function parseGifResponse(response) {
    const config = loadGifs();
    if (!config || !config.enabled || !config.gifs) return null;

    const trimmed = response.trim();
    const match = trimmed.match(/^\[GIF:(\d+)\]$/);

    if (match) {
        const index = parseInt(match[1]);
        if (index >= 0 && index < config.gifs.length) {
            if (Math.random() <= 0.9) {
                return config.gifs[index].url;
            }
            return 'RETRY';
        }
    }

    return null;
}

function checkForGifResponse(message, aiResponse) {
    const config = loadGifs();
    if (!config || !config.enabled || !config.gifs) return null;

    const combined = (message + ' ' + aiResponse).toLowerCase();

    for (const gif of config.gifs) {
        if (!gif.triggers || !gif.url) continue;

        for (const trigger of gif.triggers) {
            if (combined.includes(trigger.toLowerCase())) {
                const chance = config.chance || 0.3;
                if (Math.random() <= chance) {
                    return gif.url;
                }
            }
        }
    }

    return null;
}

module.exports = {
    loadGifs,
    buildGifPrompt,
    parseGifResponse,
    checkForGifResponse
};