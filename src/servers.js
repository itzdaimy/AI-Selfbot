const fs = require('fs');
const path = require('path');

const serversDir = path.join(__dirname, '..', 'data', 'servers');
if (!fs.existsSync(serversDir)) {
    fs.mkdirSync(serversDir, { recursive: true });
}

function getServerPath(serverId) {
    return path.join(serversDir, `${serverId}.json`);
}

function getServerData(serverId) {
    const filepath = getServerPath(serverId);
    if (!fs.existsSync(filepath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function saveServerData(serverId, data) {
    const filepath = getServerPath(serverId);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function initServerData(serverId, serverName) {
    const existing = getServerData(serverId);
    if (existing) return existing;

    const data = {
        id: serverId,
        name: serverName,
        messagesSent: 0,
        lastActive: null,
        lastBotMessage: null,
        users: {},
        topics: [],
        vibes: null,
        channelActivity: {}
    };
    saveServerData(serverId, data);
    return data;
}

function trackUserMessage(serverId, serverName, userId, username, content, channelId) {
    let data = getServerData(serverId) || initServerData(serverId, serverName);

    if (!data.users[userId]) {
        data.users[userId] = {
            username: username,
            messageCount: 0,
            lastSeen: null,
            topics: [],
            notableMessages: []
        };
    }

    const user = data.users[userId];
    user.username = username;
    user.messageCount++;
    user.lastSeen = new Date().toISOString();

    if (content.length > 20 && content.length < 500 && !content.startsWith('<')) {
        const dominated = content.match(/<[@#]\d+>/g);
        if (!dominated || dominated.length < 2) {
            if (user.notableMessages.length >= 20) {
                user.notableMessages.shift();
            }
            user.notableMessages.push({
                content: content.slice(0, 300),
                timestamp: Date.now()
            });
        }
    }

    data.lastActive = new Date().toISOString();

    if (!data.channelActivity[channelId]) {
        data.channelActivity[channelId] = { lastMessage: null, messageCount: 0 };
    }
    data.channelActivity[channelId].lastMessage = Date.now();
    data.channelActivity[channelId].messageCount++;

    saveServerData(serverId, data);
}

function trackBotMessage(serverId, serverName, channelId) {
    let data = getServerData(serverId) || initServerData(serverId, serverName);

    data.messagesSent++;
    data.lastBotMessage = new Date().toISOString();

    if (!data.channelActivity[channelId]) {
        data.channelActivity[channelId] = { lastMessage: null, messageCount: 0, botMessages: 0 };
    }
    data.channelActivity[channelId].botMessages = (data.channelActivity[channelId].botMessages || 0) + 1;

    saveServerData(serverId, data);
}

function getUserServerContext(serverId, userId) {
    const data = getServerData(serverId);
    if (!data || !data.users[userId]) return null;

    const user = data.users[userId];
    return {
        username: user.username,
        messageCount: user.messageCount,
        lastSeen: user.lastSeen,
        notableMessages: user.notableMessages || []
    };
}

function getServerContext(serverId) {
    const data = getServerData(serverId);
    if (!data) return null;

    return {
        name: data.name,
        messagesSent: data.messagesSent,
        vibes: data.vibes,
        topics: data.topics,
        userCount: Object.keys(data.users).length
    };
}

function updateServerVibes(serverId, vibes) {
    const data = getServerData(serverId);
    if (!data) return;

    data.vibes = vibes;
    saveServerData(serverId, data);
}

function updateServerTopics(serverId, topics) {
    const data = getServerData(serverId);
    if (!data) return;

    data.topics = topics;
    saveServerData(serverId, data);
}

function getDeadChats(minBotMessages, idleMinutes) {
    const dead = [];
    const now = Date.now();
    const idleMs = idleMinutes * 60 * 1000;

    const files = fs.readdirSync(serversDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(serversDir, file), 'utf8'));

            for (const [channelId, activity] of Object.entries(data.channelActivity || {})) {
                const botMsgs = activity.botMessages || 0;
                const lastMsg = activity.lastMessage || 0;

                if (botMsgs >= minBotMessages && (now - lastMsg) > idleMs) {
                    dead.push({
                        serverId: data.id,
                        serverName: data.name,
                        channelId: channelId,
                        botMessages: botMsgs,
                        idleFor: now - lastMsg
                    });
                }
            }
        } catch (e) {
        }
    }

    return dead;
}

function buildServerUserString(serverId, userId) {
    const user = getUserServerContext(serverId, userId);
    if (!user) return '';

    let parts = [];

    if (user.messageCount > 10) {
        parts.push(`You've seen ${user.username} around (${user.messageCount} messages in this server)`);
    }

    if (user.notableMessages && user.notableMessages.length > 0) {
        const recent = user.notableMessages.slice(-5);
        parts.push('Things they\'ve said recently:');
        for (const msg of recent) {
            parts.push(`- "${msg.content}"`);
        }
    }

    return parts.join('\n');
}

function buildServerContextString(serverId) {
    const server = getServerContext(serverId);
    if (!server) return '';

    let parts = [];

    if (server.vibes) {
        parts.push(`Server vibe: ${server.vibes}`);
    }

    if (server.topics && server.topics.length > 0) {
        parts.push(`Common topics: ${server.topics.join(', ')}`);
    }

    if (server.messagesSent > 0) {
        parts.push(`You've sent ${server.messagesSent} messages here`);
    }

    return parts.join('\n');
}

module.exports = {
    getServerData,
    initServerData,
    trackUserMessage,
    trackBotMessage,
    getUserServerContext,
    getServerContext,
    updateServerVibes,
    updateServerTopics,
    getDeadChats,
    buildServerUserString,
    buildServerContextString
};