const config = require('../config.json');

async function chat(systemPrompt, messages) {
    const provider = config.provider || 'openrouter';

    if (provider === 'ollama') {
        return chatOllama(systemPrompt, messages);
    }
    return chatOpenRouter(systemPrompt, messages);
}

async function chatOpenRouter(systemPrompt, messages) {
    const body = {
        model: config.model,
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages
        ]
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.openrouter_key}`,
            'HTTP-Referer': 'https://github.com/discord-selfbot',
            'X-Title': 'Discord Selfbot'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`openrouter ${res.status}: ${text}`);
    }

    const data = await res.json();

    if (!data.choices || data.choices.length === 0) {
        return null;
    }

    const message = data.choices[0].message;
    return message.content || message.text || '';
}

async function chatOllama(systemPrompt, messages) {
    const baseUrl = config.ollama?.baseUrl || 'http://localhost:11434';
    const model = config.ollama?.model || 'kimi-k2.5:cloud';

    const body = {
        model: model,
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages
        ],
        stream: false
    };

    const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`ollama ${res.status}: ${text}`);
    }

    const data = await res.json();

    if (!data.message || !data.message.content) {
        return null;
    }

    return data.message.content;
}

module.exports = { chat };