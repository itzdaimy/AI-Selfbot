const config = require('../config.json');

const conversations = new Map();

const State = {
    READING: 'reading',
    RESPONDING: 'responding',
    ENGAGED: 'engaged',
    IDLE: 'idle'
};

function getConversation(channelId) {
    return conversations.get(channelId);
}

function startConversation(channelId, triggerMsg) {
    const existing = conversations.get(channelId);
    if (existing && existing.state !== State.IDLE) {
        bufferMessage(channelId, triggerMsg);
        return existing;
    }

    const settings = config.serverChat || {};
    const readingConfig = settings.readingPeriod || {};
    const minReading = readingConfig.min || 3000;
    const maxReading = readingConfig.max || 15000;

    const readingDuration = minReading + Math.random() * (maxReading - minReading);

    const convo = {
        channelId,
        state: State.READING,
        triggerMsg,
        initiator: triggerMsg.author.id,
        participants: new Map(),
        messageBuffer: [],
        extensions: 0,
        maxExtensions: readingConfig.maxExtensions || 3,
        extendOnActivity: readingConfig.extendOnActivity !== false,
        readingEndsAt: Date.now() + readingDuration,
        readingTimer: null,
        idleTimer: null,
        replyCount: 0,
        startedAt: Date.now(),
        lastResponseAt: null,
        responding: false
    };

    convo.participants.set(triggerMsg.author.id, {
        username: triggerMsg.author.username,
        messages: []
    });

    bufferMessageInternal(convo, triggerMsg);

    conversations.set(channelId, convo);
    return convo;
}

function bufferMessage(channelId, msg) {
    const convo = conversations.get(channelId);
    if (!convo) return false;

    if (convo.state === State.IDLE) return false;

    bufferMessageInternal(convo, msg);

    if (convo.state === State.READING && convo.extendOnActivity) {
        if (convo.extensions < convo.maxExtensions) {
            const settings = config.serverChat || {};
            const readingConfig = settings.readingPeriod || {};
            const extension = (readingConfig.min || 3000) * 0.5;
            convo.readingEndsAt = Math.max(convo.readingEndsAt, Date.now() + extension);
            convo.extensions++;
        }
    }

    if (convo.state === State.ENGAGED) {
        resetIdleTimer(convo);
    }

    return true;
}

function bufferMessageInternal(convo, msg) {
    if (convo.messageBuffer.some(m => m.id === msg.id)) return;

    convo.messageBuffer.push({
        id: msg.id,
        authorId: msg.author.id,
        username: msg.author.username,
        content: msg.content,
        timestamp: msg.createdTimestamp,
        mentions: msg.mentions.users.map(u => u.id),
        reference: msg.reference ? msg.reference.messageId : null
    });

    if (!convo.participants.has(msg.author.id)) {
        convo.participants.set(msg.author.id, {
            username: msg.author.username,
            messages: []
        });
    }

    convo.participants.get(msg.author.id).messages.push(msg.id);
}

function isRelevant(channelId, msg, clientUserId) {
    const convo = conversations.get(channelId);
    if (!convo) return false;
    if (convo.state === State.IDLE) return false;

    if (msg.mentions.has(clientUserId)) return true;

    if (convo.participants.has(msg.author.id)) return true;

    if (msg.reference) {
        const referencedInBuffer = convo.messageBuffer.some(m => m.id === msg.reference.messageId);
        if (referencedInBuffer) return true;
    }

    return false;
}

function isReadingComplete(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return false;
    if (convo.state !== State.READING) return false;

    return Date.now() >= convo.readingEndsAt;
}

function transitionToResponding(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return null;
    if (convo.responding) return null;

    convo.state = State.RESPONDING;
    convo.responding = true;
    return convo;
}

function transitionToEngaged(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return;

    convo.state = State.ENGAGED;
    convo.replyCount++;
    convo.lastResponseAt = Date.now();
    convo.responding = false;
    resetIdleTimer(convo);
}

function markResponseDone(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return;
    convo.responding = false;
}

function resetIdleTimer(convo) {
    if (convo.idleTimer) {
        clearTimeout(convo.idleTimer);
    }

    const settings = config.serverChat || {};
    const engagement = settings.engagement || {};
    const idleTimeout = engagement.idleTimeout || 60000;

    convo.idleTimer = setTimeout(() => {
        disengage(convo.channelId);
    }, idleTimeout);
}

function disengage(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return;

    if (convo.idleTimer) {
        clearTimeout(convo.idleTimer);
    }
    if (convo.readingTimer) {
        clearTimeout(convo.readingTimer);
    }

    convo.state = State.IDLE;
    conversations.delete(channelId);
}

function shouldContinueEngaging(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return false;

    const settings = config.serverChat || {};
    const engagement = settings.engagement || {};
    const maxReplies = engagement.maxReplies || 10;

    if (convo.replyCount >= maxReplies) {
        disengage(channelId);
        return false;
    }

    return convo.state === State.ENGAGED;
}

function hasNewMessages(channelId, clientUserId) {
    const convo = conversations.get(channelId);
    if (!convo) return false;
    if (convo.responding) return false;

    const lastResponse = convo.lastResponseAt || 0;

    for (const msg of convo.messageBuffer) {
        if (msg.timestamp <= lastResponse) continue;
        if (msg.authorId === clientUserId) continue;
        return true;
    }

    return false;
}

function getContext(channelId, clientUserId) {
    const convo = conversations.get(channelId);
    if (!convo) return null;

    const messages = [];
    const sorted = [...convo.messageBuffer].sort((a, b) => a.timestamp - b.timestamp);

    for (const msg of sorted) {
        messages.push({
            role: msg.authorId === clientUserId ? 'assistant' : 'user',
            content: `[${msg.username}]: ${msg.content}`,
            authorId: msg.authorId,
            username: msg.username,
            id: msg.id,
            timestamp: msg.timestamp
        });
    }

    return {
        messages,
        participants: [...convo.participants.keys()],
        initiator: convo.initiator,
        triggerMsgId: convo.triggerMsg.id,
        lastResponseAt: convo.lastResponseAt
    };
}

function getReplyTarget(channelId, clientUserId) {
    const convo = conversations.get(channelId);
    if (!convo) return null;

    const lastResponse = convo.lastResponseAt || 0;
    const sorted = [...convo.messageBuffer]
        .filter(m => m.timestamp > lastResponse)
        .sort((a, b) => b.timestamp - a.timestamp);

    for (const msg of sorted) {
        if (msg.authorId !== clientUserId && msg.mentions.includes(clientUserId)) {
            return msg.id;
        }
    }

    for (const msg of sorted) {
        if (msg.authorId === convo.initiator && msg.authorId !== clientUserId) {
            return msg.id;
        }
    }

    for (const msg of sorted) {
        if (msg.authorId !== clientUserId) {
            return msg.id;
        }
    }

    return convo.triggerMsg.id;
}

function getActiveChannels() {
    const active = [];
    for (const [channelId, convo] of conversations) {
        if (convo.state === State.READING && isReadingComplete(channelId)) {
            active.push(channelId);
        }
    }
    return active;
}

function startResponding(channelId) {
    const convo = conversations.get(channelId);
    if (!convo) return false;
    if (convo.responding) return false;
    convo.responding = true;
    return true;
}

module.exports = {
    State,
    getConversation,
    startConversation,
    bufferMessage,
    isRelevant,
    isReadingComplete,
    transitionToResponding,
    transitionToEngaged,
    markResponseDone,
    disengage,
    shouldContinueEngaging,
    hasNewMessages,
    getContext,
    getReplyTarget,
    getActiveChannels,
    startResponding
};